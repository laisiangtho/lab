/**
 * Memory verses: learning passages by heart, a few minutes a day.
 *
 * A verse is added from its verse bar ("Memorize") or the palette
 * (`memorize ps 23:1-3`). The Memory verses page lists them with how far each
 * has come and when it is next due, and "Practise" walks through the ones due
 * today: the verse with some of its words hidden — more as it sticks — a
 * press on a gap to peek at one word, "Show" for all of it, and then the
 * reader's own verdict: Again, Hard, or Got it. The spacing and the hiding are
 * `core/memory.js`; this is their surface.
 *
 * The text is quoted from the translation the verse was added in, when that
 * is still on this device, so the words being learned do not change under the
 * reader because they switched editions; otherwise from the one being read.
 *
 * Cards are the feature record `memory`, so they travel in the settings
 * export with the notes.
 */

import { cardId, dueCards, levelOf, mask, newCard, readCards, review, summary, writeCards, LAST_BOX } from '../../core/memory.js';
import { extractStrongs } from '../../core/strongs.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { currentLocale, L } from '../../shell/i18n.js';

const KEY = 'memory';

export default {
  id: 'memory',
  setup(ctx) {
    const { records, registry, shell, state, store } = ctx;
    const cards = () => readCards(records.get(KEY, null));
    const save = (list) => records.save(KEY, writeCards(list));
    const has = (book, chapter, verse) => cards().some((card) => card.id === cardId(book, chapter, verse));

    async function add(passage) {
      const list = cards();
      const card = newCard({ ...passage, identify: state.get().translation ?? null });
      if (list.some((held) => held.id === card.id)) return false;
      await save([...list, card]);
      return true;
    }

    async function remove(id) {
      await save(cards().filter((card) => card.id !== id));
    }

    const refOf = (card) => {
      const where = shell.workspace;
      const verses = card.to ? `${where.number(card.verse)}–${where.number(card.to)}` : where.number(card.verse);
      return `${where.bookName(card.book)} ${where.number(card.chapter)}:${verses}`;
    };

    /** The words of a card, from its own translation when that is still here. */
    async function textOf(card) {
      const held = await store.list();
      const identify = held.some((row) => row.identify === card.identify) ? card.identify : state.get().translation;
      if (!identify) return { text: '', identify: null };
      const verses = await store.getChapter(identify, card.book, card.chapter);
      const parts = [];
      for (let v = card.verse; v <= (card.to ?? card.verse); v += 1) {
        const text = verses?.[v]?.text;
        if (text) parts.push(extractStrongs(String(text)).text);
      }
      const meta = held.find((row) => row.identify === identify);
      return { text: parts.join(' '), identify, lang: meta?.info?.language ?? null };
    }

    registry.verseAction({
      id: 'memory.toggle',
      title: (p) => (has(p.book, p.chapter, p.verse) ? L('mem.stop') : L('mem.add')),
      icon: 'spark',
      isOn: (p) => has(p.book, p.chapter, p.verse),
      run: async (p) => {
        if (has(p.book, p.chapter, p.verse)) {
          await remove(cardId(p.book, p.chapter, p.verse));
          shell.notify(L('mem.removed'));
          return;
        }
        await add({ book: p.book, chapter: p.chapter, verse: p.verse, to: p.to ?? null });
        shell.notify(L('mem.added', { ref: refOf({ ...p, to: p.to ?? null }) }));
      },
    });

    registry.verb({
      id: 'memory.verb',
      word: 'memorize',
      title: L('mem.verb'),
      icon: 'spark',
      hint: L('mem.verbHint'),
      run: async (p) => {
        const passage = { book: p.book, chapter: p.chapter, verse: p.verse ?? 1, to: p.to ?? null };
        const added = await add(passage);
        shell.notify(added ? L('mem.added', { ref: refOf(passage) }) : L('mem.already', { ref: refOf(passage) }));
      },
    });

    registry.command({
      id: 'memory.open',
      title: L('doc.memory'),
      icon: 'spark',
      opens: 'memory',
      run: () => shell.openDoc('memory'),
    });

    registry.doc({
      id: 'memory',
      title: L('doc.memory'),
      icon: 'spark',
      mount(el) {
        const root = h('div', { class: 'doc mem' });
        el.append(root);
        /** A practice under way: the cards left, and how far through. */
        let session = null;

        const days = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
        const dueLabel = (due) => {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const n = Math.floor((due - start) / 86400000);
          return due <= Date.now() ? L('mem.dueNow') : days.format(Math.max(n, 0), 'day');
        };

        function paint() {
          if (session) { paintPractice(); return; }
          const list = cards();
          const s = summary(list);
          const head = [
            h('h1', { class: 'inline-title' }, L('doc.memory')),
            h('p', { class: 'doc-lede' }, list.length
              ? L('mem.lede', { n: s.total, due: s.due, learned: s.learned })
              : L('mem.empty')),
          ];
          const start = s.due
            ? h('button', { class: 'btn primary mem-start', onclick: () => begin() }, icon('play'), L('mem.practise', { n: s.due }))
            : list.length ? h('p', { class: 'mem-rest' }, s.next ? L('mem.nextDue', { when: dueLabel(s.next) }) : '') : null;
          const rows = list
            .sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse)
            .map((card) => {
              const text = h('span', { class: 'mem-text' }, '…');
              textOf(card).then(({ text: words, lang }) => {
                text.textContent = words || L('mem.noText');
                if (lang?.code) text.lang = lang.code;
              }).catch(() => { text.textContent = L('mem.noText'); });
              return h('div', { class: 'mem-row', dataset: { id: card.id } },
                h('button', {
                  class: 'mem-open', onclick: () => shell.openVerse(card.book, card.chapter, card.verse),
                }, h('span', { class: 'mem-ref' }, refOf(card)), text),
                h('span', { class: 'mem-box', title: L('mem.boxTitle', { n: card.box, of: LAST_BOX }) },
                  ...Array.from({ length: LAST_BOX }, (_, i) => h('i', { class: i < card.box ? 'on' : '' }))),
                h('span', { class: 'mem-due' }, dueLabel(card.due)),
                h('button', {
                  class: 'mem-remove', title: L('mem.stop'), 'aria-label': L('mem.stop'),
                  onclick: () => remove(card.id),
                }, icon('x')));
            });
          fill(root, ...head, start, rows.length ? h('div', { class: 'mem-list' }, ...rows) : null);
        }

        function begin() {
          const due = dueCards(cards());
          if (!due.length) return;
          session = { queue: due.map((card) => card.id), index: 0, done: 0, revealed: false };
          paint();
        }

        async function paintPractice() {
          const id = session.queue[session.index];
          const card = cards().find((c) => c.id === id);
          if (!card) { finish(); return; }
          const { text, lang } = await textOf(card);
          if (!session || session.queue[session.index] !== id) return;
          const parts = mask(text, session.revealed ? 'none' : levelOf(card.box), card.id);
          const line = h('p', {
            class: 'mem-verse', lang: lang?.code || undefined, dir: lang?.textdirection || 'auto',
          }, ...parts.map((part) => {
            if (!part.word || !part.hidden) return part.text;
            // A gap is as wide as the word it hides, so the shape of the line
            // is a clue; pressing it shows that one word.
            return h('button', {
              class: 'mem-gap', dataset: { hint: part.hint },
              style: { '--w': `${[...part.text].length}ch` },
              'aria-label': L('mem.peek'),
              onclick: (e) => { e.currentTarget.replaceWith(h('span', { class: 'mem-peeked' }, part.text)); },
            }, part.hint);
          }));
          const grade = (g) => h('button', {
            class: `btn mem-grade mem-${g}`, onclick: () => rate(card, g),
          }, L(`mem.grade.${g}`));
          fill(root,
            h('div', { class: 'mem-practice' },
              h('div', { class: 'mem-progress' },
                h('span', {}, L('mem.of', { n: session.index + 1, of: session.queue.length })),
                h('span', { class: 'spacer' }),
                h('button', { class: 'mem-quit', onclick: () => { session = null; paint(); } }, L('mem.quit'))),
              h('div', { class: 'mem-card' },
                h('div', { class: 'mem-card-ref' }, refOf(card)),
                text ? line : h('p', { class: 'mem-verse mem-missing' }, L('mem.noText'))),
              session.revealed
                ? h('div', { class: 'mem-grades' }, grade('again'), grade('hard'), grade('good'))
                : h('div', { class: 'mem-grades' },
                  h('button', { class: 'btn primary mem-show', onclick: () => { session.revealed = true; paint(); } }, L('mem.show')))));
          root.querySelector('.mem-show, .mem-good')?.focus({ preventScroll: true });
        }

        async function rate(card, grade) {
          const list = cards().map((c) => (c.id === card.id ? review(c, grade) : c));
          await save(list);
          // "Again" comes back later in the same practice.
          if (grade === 'again') session.queue.push(card.id);
          session.index += 1;
          session.done += 1;
          session.revealed = false;
          if (session.index >= session.queue.length) finish();
          else paint();
        }

        function finish() {
          const next = summary(cards()).next;
          session = null;
          fill(root,
            h('div', { class: 'mem-practice mem-finished' },
              h('span', { class: 'mem-done-mark' }, icon('check')),
              h('h2', {}, L('mem.finished')),
              h('p', { class: 'doc-lede' }, next ? L('mem.nextDue', { when: dueLabel(next) }) : ''),
              h('button', { class: 'btn', onclick: () => paint() }, L('mem.back'))));
        }

        const onKey = (e) => {
          if (!session || !root.isConnected || e.target.closest?.('input, textarea')) return;
          if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); session.revealed = true; paint(); return; }
          if (session.revealed && ['1', '2', '3'].includes(e.key)) {
            const card = cards().find((c) => c.id === session.queue[session.index]);
            if (card) { e.preventDefault(); rate(card, ['again', 'hard', 'good'][Number(e.key) - 1]); }
          }
        };
        document.addEventListener('keydown', onKey);
        const off = records.on('change', ({ detail }) => { if (!session && (detail?.key === KEY || detail?.key === null)) paint(); });
        paint();
        return () => { document.removeEventListener('keydown', onKey); off(); };
      },
    });
  },
};
