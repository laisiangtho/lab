/**
 * One verse in every translation on this device, in one place.
 *
 * Parallel panes answer "read these side by side"; this answers the quicker
 * and far more common question, "how do the others put this verse?" — without
 * opening a pane per translation and scrolling each to the same place.
 *
 * Every row is the translation's own text in its own language and direction.
 * A translation that merges the verse with its neighbour shows the merged
 * verse and says which verses it covers; one that does not carry the verse at
 * all says so rather than leaving a gap. The arrows step to the verse before
 * or after, so a reader can walk a passage across every edition at once.
 *
 * The rows are read from the store as they are needed: a chapter per
 * translation, kept while the dialog is open, so stepping through verses reads
 * nothing twice.
 */

import { verseAt } from '../../core/align.js';
import { extractStrongs } from '../../core/strongs.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

export default {
  id: 'compare',
  setup(ctx) {
    const { registry, shell, state, store, category } = ctx;
    let dialog = null;

    registry.verseAction({
      id: 'compare.verse',
      title: L('cmp.action'),
      icon: 'compare',
      run: (p) => open(p.book, p.chapter, p.verse),
    });

    registry.verb({
      id: 'compare.verb',
      word: 'compare',
      title: L('cmp.verb'),
      icon: 'compare',
      hint: L('cmp.verbHint'),
      run: (p) => open(p.book, p.chapter, p.verse ?? 1),
    });

    /** @param {number} book @param {number} chapter @param {number} verse */
    async function open(book, chapter, verse) {
      dialog ??= createDialog();
      await dialog.show(book, chapter, verse);
    }

    function createDialog() {
      const title = h('h2', { class: 'cmp-title' });
      const list = h('div', { class: 'cmp-list', role: 'list' });
      const prev = h('button', { class: 'cmp-step cmp-prev', title: L('cmp.prev'), 'aria-label': L('cmp.prev'), onclick: () => step(-1) }, icon('chev'));
      const next = h('button', { class: 'cmp-step', title: L('cmp.next'), 'aria-label': L('cmp.next'), onclick: () => step(+1) }, icon('chev'));
      const copyAll = h('button', { class: 'btn soft', onclick: () => copyEvery() }, icon('copy'), L('cmp.copyAll'));
      const close = h('button', { class: 'cmp-close', title: L('cmd.close'), 'aria-label': L('cmd.close'), onclick: () => hide() }, icon('x'));
      const box = h('div', { class: 'cmp', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cmp-title' },
        h('div', { class: 'cmp-head' }, prev, title, next, h('span', { class: 'spacer' }), close),
        list,
        h('div', { class: 'cmp-foot' }, h('span', { class: 'cmp-count' }), copyAll));
      title.id = 'cmp-title';
      const element = h('div', { class: 'scrim cmp-scrim', hidden: true }, box);
      element.addEventListener('pointerdown', (e) => { if (e.target === element) hide(); });
      element.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); hide(); }
        if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') { e.preventDefault(); step(-1); }
        if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') { e.preventDefault(); step(+1); }
      });
      document.body.append(element);

      /** Chapters already read while open: "identify/book/chapter" → verses. */
      const chapters = new Map();
      let at = null;
      let rows = [];

      async function chapterOf(identify, book, chapter) {
        const key = `${identify}/${book}/${chapter}`;
        if (!chapters.has(key)) chapters.set(key, await store.getChapter(identify, book, chapter));
        return chapters.get(key);
      }

      async function show(book, chapter, verse) {
        at = { book, chapter, verse };
        element.hidden = false;
        await paint();
        (list.querySelector('button') ?? close).focus({ preventScroll: true });
      }

      function hide() {
        element.hidden = true;
        chapters.clear();
      }

      /** The verse before or after, crossing into the next chapter at an end. */
      async function step(delta) {
        if (!at) return;
        let { book, chapter, verse } = at;
        verse += delta;
        const last = await lastVerse(book, chapter);
        if (verse < 1) {
          if (chapter === 1) return;
          chapter -= 1;
          verse = await lastVerse(book, chapter);
        } else if (verse > last) {
          if (chapter >= category.book(book).chapters) return;
          chapter += 1;
          verse = 1;
        }
        at = { book, chapter, verse };
        await paint();
      }

      /** The last verse any translation here carries in a chapter, else the canon's count. */
      async function lastVerse(book, chapter) {
        const held = await store.list();
        let last = 0;
        for (const row of held) {
          const verses = await chapterOf(row.identify, book, chapter);
          for (const key of Object.keys(verses ?? {})) last = Math.max(last, Number(key) || 0);
        }
        return last || (category.book(book).verses?.[chapter - 1] ?? 1);
      }

      async function paint() {
        const { book, chapter, verse } = at;
        const where = shell.workspace;
        title.textContent = `${where.bookName(book)} ${where.number(chapter)}:${where.number(verse)}`;
        const held = await store.list();
        const current = state.get().translation;
        // The one being read first, then the rest by language and name.
        held.sort((a, b) => (b.identify === current) - (a.identify === current)
          || String(a.info?.language?.text ?? '').localeCompare(String(b.info?.language?.text ?? ''))
          || String(a.info?.name ?? '').localeCompare(String(b.info?.name ?? '')));
        rows = await Promise.all(held.map(async (row) => {
          const found = verseAt(await chapterOf(row.identify, book, chapter), verse);
          return { row, found, text: found ? extractStrongs(String(found.verse.text ?? '')).text : null };
        }));
        fill(list, rows.length ? rows.map(line) : h('p', { class: 'empty-hint' }, L('cmp.none')));
        const carrying = rows.filter((r) => r.found).length;
        element.querySelector('.cmp-count').textContent = L('cmp.count', { n: carrying, of: rows.length });
      }

      function line({ row, found, text }) {
        const info = row.info ?? {};
        const lang = info.language ?? {};
        const span = found && found.end !== found.start ? L('cmp.merged', { from: found.start, to: found.end }) : '';
        return h('div', { class: 'cmp-row', role: 'listitem', dataset: { identify: row.identify } },
          h('div', { class: 'cmp-meta' },
            h('span', { class: 'cmp-short' }, info.shortname || row.identify),
            h('span', { class: 'cmp-name' }, [info.name, lang.text].filter(Boolean).join(' · ')),
            span ? h('span', { class: 'cmp-span' }, span) : null,
            h('span', { class: 'spacer' }),
            found ? h('button', {
              class: 'cmp-act', title: L('cmd.copyVerse'), 'aria-label': L('cmd.copyVerse'),
              onclick: () => copy(row, found, text),
            }, icon('copy')) : null,
            h('button', {
              class: 'cmp-act', title: L('cmp.read'), 'aria-label': L('cmp.read'),
              onclick: () => { hide(); readIn(row.identify); },
            }, icon('book-open'))),
          found
            ? h('p', { class: 'cmp-text', lang: lang.code || undefined, dir: lang.textdirection || 'auto' }, text)
            : h('p', { class: 'cmp-text cmp-missing' }, L('cmp.missing')));
      }

      function refOf(row, found) {
        const where = shell.workspace;
        const verses = found.end !== found.start ? `${found.start}–${found.end}` : String(found.start);
        return `${where.bookName(at.book)} ${at.chapter}:${verses} (${row.info?.shortname || row.identify})`;
      }

      async function copy(row, found, text) {
        await navigator.clipboard.writeText(`${text}\n— ${refOf(row, found)}`);
        shell.notify(L('msg.copied', { what: refOf(row, found) }));
      }

      async function copyEvery() {
        const text = rows.filter((r) => r.found).map((r) => `${r.text}\n— ${refOf(r.row, r.found)}`).join('\n\n');
        if (!text) return;
        await navigator.clipboard.writeText(text);
        shell.notify(L('cmp.copiedAll', { n: rows.filter((r) => r.found).length }));
      }

      /** Read the verse in that translation: make it the one in use, and go there. */
      function readIn(identify) {
        shell.workspace.setPaneTranslation(0, identify);
        shell.openVerse(at.book, at.chapter, at.verse);
      }

      return { show };
    }
  },
};
