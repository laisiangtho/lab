/**
 * A translation, looked at closely.
 *
 * Three surfaces already say something about a translation and none of them
 * can say this. The library row has one line for it; the information popover
 * is a summary and has twice had to be rescued from the length of a licence;
 * "Data and formats" documents the shape of the files rather than the contents
 * of one. What was missing is the place a row like
 *
 *     65 of 66 books · 49 chapters a different length
 *
 * leads to — because until now it led nowhere, and a count nobody can open is
 * a count nobody can act on.
 *
 * It is a document rather than a pane: it is read once, it is wide, and it is
 * not consulted while reading. Panes are for what is wanted *beside* the text.
 *
 * **A book is the row.** The first version had a section per kind of finding —
 * differences here, merges there, headings somewhere else — which asks the
 * reader to hold three lists in their head to answer one question: *what about
 * Isaiah?* A book is the unit somebody actually works in, so the page is the
 * figures and then one list of books, each carrying three numbers and opening
 * onto the chapters those numbers came from.
 *
 * It opens on what the record already holds. One press then walks the chapters
 * — `core/examine.js` — and answers, from that single pass, where the merges
 * are, where the headings are, and every difference from the canon rather than
 * the four hundred the record was allowed to keep.
 *
 * The answer is kept per translation at feature scope rather than in the
 * mount, because a document is unmounted when another tab is shown: a walk
 * paid for once should not be paid for again for having looked at a chapter.
 *
 * Which translation it is about travels through `state.reportFor`, the way the
 * notes pane is told which verse it is writing about. A document takes no
 * argument, and a document id per translation would be sixty-four of them.
 */

import { createExamination, groupByBook } from '../../core/examine.js';
import { formatBytes, fill, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { openMenu } from '../../shell/menu.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { VERSION } from '../../version.js';

export default {
  id: 'report',
  setup(ctx) {
    const { category, registry, shell, state, store } = ctx;

    /**
     * What each examined translation turned out to hold, kept across mounts.
     * Emptied for one translation when that translation is installed again.
     */
    const examined = new Map();
    ctx.library.on('change', () => examined.clear());

    /** Which translation the report is about: the one asked for, else the one being read. */
    const subject = () => state.get().reportFor ?? state.get().translation ?? null;

    const openFor = (identify) => {
      state.set({ reportFor: identify ?? null });
      shell.openDoc('report');
    };

    registry.command({
      id: 'report.open',
      title: L('doc.report'),
      icon: 'inspector',
      opens: 'report',
      // Asked for by name rather than from a row: the translation in front of
      // the reader is the one they mean.
      run: () => openFor(state.get().translation ?? null),
    });

    registry.doc({
      id: 'report',
      title: L('doc.report'),
      icon: 'inspector',
      mount(el) {
        let identify = null;
        let running = false;
        /** Books whose chapters are showing. */
        const open = new Set();
        let token = 0;

        const found = () => examined.get(identify) ?? null;

        async function paint() {
          const run = ++token;
          const wanted = subject();
          if (wanted !== identify) { open.clear(); identify = wanted; }
          if (!identify) { draw(null, null); return; }
          const meta = await store.getMeta(identify);
          const held = (await store.list()).find((row) => row.identify === identify) ?? null;
          if (run !== token) return;
          draw(meta, held);
        }

        function draw(meta, held) {
          keepPlace(el, () => fill(el, h('section', { class: 'doc rp' },
            meta ? head(meta, held) : blank(),
            ...(meta ? sections(meta, held) : []))));
        }

        const blank = () => h('div', { class: 'rp-blank' },
          h('span', { class: 'rp-blank-mark' }, icon('inspector')),
          h('h2', {}, L('rp.blankTitle')),
          h('p', { class: 'muted' }, L('rp.blankBody')));

        /** The name, what to do to it, and what to take away. */
        function head(meta, held) {
          return h('header', { class: 'rp-head' },
            h('div', { class: 'rp-name' },
              h('h1', {}, meta.info.name),
              h('p', { class: 'muted' }, [
                meta.info.shortname,
                meta.info?.language?.text ?? null,
                held?.bytes ? formatBytes(held.bytes) : null,
              ].filter(Boolean).join(' · '))),
            h('div', { class: 'rp-head-acts' },
              h('button', {
                class: 'btn primary', disabled: running,
                onclick: () => examine(meta),
              }, icon(running ? 'sync' : 'search'), L(running ? 'rp.working' : found() ? 'rp.again' : 'rp.examine')),
              h('button', {
                class: 'btn', title: L('rp.save'), 'aria-label': L('rp.save'),
                onclick: (e) => openMenu(e.currentTarget, [
                  { id: 'md', title: L('rp.asMarkdown'), sub: L('rp.asMarkdownSub'), icon: 'quote', run: () => save(meta, held, 'md') },
                  { id: 'json', title: L('rp.asJson'), sub: L('rp.asJsonSub'), icon: 'db', run: () => save(meta, held, 'json') },
                ]),
              }, icon('download'))));
        }

        /** Walk every chapter once, and keep the answer. */
        async function examine(meta) {
          if (running) return;
          running = true;
          const pass = createExamination({ category, story: meta.story ?? {} });
          draw(meta, null);
          try {
            await store.scanChapters(identify, (row) => pass.visit(row));
            examined.set(identify, pass.report(meta));
          } catch (err) {
            shell.notify(err.message, 'error');
          } finally {
            running = false;
            paint();
          }
        }

        /** A book and chapter, as a button that opens it. */
        const place = (book, chapter, verse = null) => h('button', {
          class: 'rp-go',
          title: shell.workspace.englishRef(book, chapter),
          onclick: (e) => (verse
            ? shell.openVerse(book, chapter, verse, { newTab: wantsNewTab(e) })
            : shell.openChapter(book, chapter, { newTab: wantsNewTab(e) })),
        }, chapter
          ? `${shell.workspace.bookName(book)} ${shell.workspace.number(chapter)}`
          : shell.workspace.bookName(book));

        /** A row of figures, each with what it counts under it. */
        const figures = (pairs) => h('div', { class: 'rp-figures' },
          pairs.filter(Boolean).map(([value, key, n = value]) => h('div', { class: 'rp-fig' },
            h('b', {}, String(value)),
            h('span', {}, L(key, { n })))));

        /** How many pericope headings the record carries, which is free to count. */
        function storyCount(meta) {
          let n = 0;
          for (const chapters of Object.values(meta.story ?? {})) {
            for (const verses of Object.values(chapters ?? {})) n += Object.keys(verses ?? {}).length;
          }
          return n;
        }

        function sections(meta, held) {
          const stats = held?.stats ?? null;
          const diag = held?.diagnostics ?? null;
          const count = found()?.count ?? null;

          return [
            h('section', { class: 'rp-sec' },
              h('h2', {}, L('rp.holds')),
              figures([
                [found()?.books ?? stats?.books ?? 0, 'rp.books'],
                [count?.chapters ?? stats?.chapters ?? 0, 'rp.chapters'],
                [count?.verses ?? stats?.verses ?? 0, 'rp.verses'],
                [count?.merges ?? stats?.merges ?? 0, 'rp.merges'],
                [count ? count.stories + count.titles : (stats?.titles ?? 0) + storyCount(meta), 'rp.headings'],
                [stats?.refs ?? 0, 'rp.refs'],
              ]),
              // What the canon has to say, as three more figures rather than a
              // section of its own: they answer the same question as the ones
              // above — what is in this file — from the other direction.
              figures([
                [count?.missing ?? diag?.missing ?? 0, 'rp.missing'],
                [count?.short ?? diag?.short ?? 0, 'rp.short'],
                [count?.extra ?? diag?.extra ?? 0, 'rp.extra'],
              ]),
              h('p', { class: 'rp-lede muted' }, L('rp.canonWhy'))),

            booksSection(meta, diag),
          ];
        }

        /** Every book of the canon, and what there is to say about each. */
        function booksSection(meta, diag) {
          const rows = found()?.byBook ?? partial(meta, diag);
          const partialCounts = !found();
          return h('section', { class: 'rp-sec' },
            h('h2', {}, L('rp.booksTitle')),
            h('p', { class: 'rp-lede muted' },
              partialCounts ? L('rp.booksPartial') : L('rp.booksWhy')),
            h('ul', { class: 'rp-books' }, rows.map((row) => bookRow(row, partialCounts))));
        }

        /**
         * The same shape from the record alone, before a pass has run: the
         * record knows which books are absent and which chapters it recorded
         * as a different length, and nothing about merges or headings.
         */
        const partial = (meta, diag) => groupByBook({ category, meta, canon: diag?.items ?? [] });

        function bookRow(row, partialCounts) {
          const nothing = !row.present;
          const shown = open.has(row.id);
          const detail = row.chapters.length || row.desc;

          const badge = (key, value, kind) => h('span', {
            class: `rp-badge is-${kind}${value ? '' : ' is-nil'}`,
            title: L(`rp.badge.${kind}`),
          }, `${key}${value === null ? '·' : value}`);

          const head = h('button', {
            class: `rp-book${shown ? ' is-open' : ''}${nothing ? ' is-absent' : ''}`,
            disabled: nothing || !detail,
            'aria-expanded': detail ? String(shown) : null,
            onclick: () => {
              if (shown) open.delete(row.id); else open.add(row.id);
              paint();
            },
          },
            h('span', { class: 'rp-chev' }, detail && !nothing ? icon('chev') : null),
            h('span', { class: 'rp-bid' }, String(row.id)),
            h('span', { class: 'rp-bname' }, row.name),
            nothing
              ? h('span', { class: 'rp-absent' }, L('rp.kind.missing-book'))
              : h('span', { class: 'rp-badges' },
                badge('M', partialCounts ? null : row.merges, 'merge'),
                badge('H', partialCounts ? null : row.headings, 'heading'),
                badge('L', row.lengths, 'length')));

          if (!shown || nothing) return h('li', {}, head);

          // A description is a line until it is asked for: some editions write
          // a paragraph about every book, and sixty-six paragraphs is a page
          // nobody scrolls past to reach the chapters underneath.
          const desc = row.desc
            ? h('p', {
              class: 'rp-desc',
              title: row.desc,
              onclick: (e) => e.currentTarget.classList.toggle('is-open'),
            }, row.desc)
            : null;

          return h('li', {}, head, h('div', { class: 'rp-detail' },
            desc,
            row.chapters.length
              ? h('ul', { class: 'rp-chapters' }, row.chapters.map((chapter) => h('li', {},
                place(row.id, chapter.chapter),
                h('span', { class: 'rp-said' }, [
                  chapter.length
                    ? (chapter.length.type === 'extra-chapter'
                      ? L('rp.saidChapters', { expected: chapter.length.expected })
                      : L('rp.saidVerses', { actual: chapter.length.actual, expected: chapter.length.expected }))
                    : null,
                  chapter.merges.length
                    ? chapter.merges.map((m) => `${m.verse}–${m.to}`).join(', ')
                    : null,
                  chapter.headings ? L('rp.nHeadings', { n: chapter.headings }) : null,
                ].filter(Boolean).join(' · ')))))
              : null));
        }

        /** The report as a file: one to read, one to compare against later. */
        function save(meta, held, how) {
          const rows = found()?.byBook ?? partial(meta, held?.diagnostics);
          const name = `${meta.identify}-report`;
          if (how === 'json') {
            const body = {
              app: 'lai-siangtho', kind: 'report', schema: 1, appVersion: VERSION,
              identify: meta.identify, name: meta.info.name, version: meta.version,
              examined: Boolean(found()),
              count: found()?.count ?? held?.stats ?? null,
              books: rows.map((row) => ({
                id: row.id, name: row.english, present: row.present,
                merges: row.merges, headings: row.headings, lengths: row.lengths,
                chapters: row.chapters.map((c) => ({
                  chapter: c.chapter,
                  length: c.length ? { expected: c.length.expected, actual: c.length.actual ?? null } : null,
                  merges: c.merges.map((m) => [m.verse, m.to]),
                  headings: c.headings,
                })),
              })),
            };
            download(`${name}.json`, JSON.stringify(body, null, 2), 'application/json');
            return;
          }
          download(`${name}.md`, markdown(meta, rows), 'text/markdown');
        }

        /**
         * Markdown for a person: the figures, then a line per book that has
         * anything to say. Deliberately without a date — a report that differs
         * from last month's only in its timestamp is a report nobody can diff.
         */
        function markdown(meta, rows) {
          const count = found()?.count ?? null;
          const lines = [`# ${meta.info.name}`, '', `\`${meta.identify}\` · version ${meta.version}`, ''];
          if (count) {
            lines.push(`${count.chapters} chapters · ${count.verses} verses · ${count.merges} merged · `
              + `${count.stories + count.titles} headings`, '',
              `${count.missing} books missing · ${count.short} chapters a different length · `
              + `${count.extra} chapters past the canon`, '');
          }
          for (const row of rows) {
            if (!row.present) { lines.push(`- **${row.english}** — missing`); continue; }
            if (!row.chapters.length) continue;
            lines.push(`- **${row.english}** — M:${row.merges ?? '?'} H:${row.headings ?? '?'} L:${row.lengths}`);
            for (const chapter of row.chapters) {
              const said = [
                chapter.length
                  ? (chapter.length.type === 'extra-chapter'
                    ? `past the canon (stops at ${chapter.length.expected})`
                    : `covers ${chapter.length.actual}, canon says ${chapter.length.expected}`)
                  : null,
                chapter.merges.length ? `merged ${chapter.merges.map((m) => `${m.verse}–${m.to}`).join(', ')}` : null,
                chapter.headings ? `${chapter.headings} headings` : null,
              ].filter(Boolean).join('; ');
              lines.push(`  - ${row.english} ${chapter.chapter} — ${said}`);
            }
          }
          return `${lines.join('\n')}\n`;
        }

        function download(name, text, type) {
          const url = URL.createObjectURL(new Blob([text], { type }));
          const link = h('a', { href: url, download: name });
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          shell.notify(L('rp.saved', { name }));
        }

        const offState = state.subscribe(paint);
        paint();
        return () => { token += 1; offState(); };
      },
    });
  },
};
