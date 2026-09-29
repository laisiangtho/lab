/**
 * Books pane: testaments, books, and a grid of chapter chips under the open
 * book. Where the reader is, is traced by the branch line, not a filled row.
 *
 * Two ways to use it, and a switch between them. **Following** means the book
 * being read opens itself, which is what most reading wants; it also means a
 * book cannot be shut while it is the one on screen, which reads as a fault
 * the first time it happens. With following off, every branch is the reader's
 * to open and close, and the tree stays where they left it.
 *
 * Either way, a branch closed by hand stays closed: the open set records both
 * what was opened ("b5") and what was deliberately shut ("!b5"), so a rule that
 * would otherwise open a branch does not overrule the reader.
 */

import { createLookup, parsePassageQuery, passageOf } from '../core/lookup.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

const KEY = 'books';

export function createTree(ctx, { onOpen }) {
  const open = new Set();
  const held = ctx.records.get(KEY, null);
  let follow = held?.follow !== false;
  /** Chapter chips carry how long the chapter is, unless the reader turns it off. */
  // Off unless asked for. The count under each chapter number answers a
  // question most readers are not asking, and in a script whose digits are
  // built from stacked strokes it is two numbers competing for one box.
  let counts = held?.counts === true;
  const remember = () => ctx.records.save(KEY, { follow, counts })
    .catch(() => { /* a preference is not worth a message */ });
  const filterInput = h('input', { id: 'filterBooks', spellcheck: 'false', placeholder: L('ph.filter') });
  const followButton = h('button', {
    class: 'tree-follow', 'aria-pressed': String(follow),
    title: L('tree.follow'), 'aria-label': L('tree.follow'),
    onclick: () => {
      follow = !follow;
      followButton.setAttribute('aria-pressed', String(follow));
      remember();
      paint();
    },
  }, icon('target'));
  const tree = h('div', { class: 'tree' });
  let bookName = (id) => ctx.category.book(id).name;
  // Names in the translation's own language, and the tag its script needs.
  let names = {
    testament: (id) => ctx.category.testaments.find((t) => t.id === id)?.name ?? '',
    lang: () => '',
    number: (n) => String(n),
    // The canon's English name, for a label the reader may not be able to read.
    english: (id) => ctx.category.book(id).name,
    englishTestament: (id) => ctx.category.testaments.find((t) => t.id === id)?.name ?? '',
    englishRef: (book, chapter) => `${ctx.category.book(book).name} ${chapter}`,
    // Whether the translation being read carries the book at all.
    has: () => true,
    // The translation's own numerals, when it has a table of them.
    digits: () => null,
  };

  const element = h('div', { class: 'files-pane' },
    h('div', { class: 'field' }, icon('search'), filterInput, followButton),
    tree);

  filterInput.addEventListener('input', paint);
  filterInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const asked = passage(filterInput.value.trim());
    if (!asked) return;
    const target = asked.at(asked.books[0]);
    e.preventDefault();
    onOpen(target.book, target.chapter);
  });

  /** The book the tree last opened itself to, so a move can be told from a repaint. */
  let followed = null;

  function paint() {
    const typed = filterInput.value.trim();
    const query = typed.toLowerCase();
    const { book: currentBook, chapter: currentChapter } = ctx.state.get();
    // "ps 23" is a filter as much as a reference: the tree narrows to the book
    // and opens it at that chapter, so the same shorthand works here as in the
    // palette. Enter goes there.
    const asked = passage(typed);
    // Moving to another book while following clears any close the reader made
    // on it earlier: they asked to be taken there.
    if (follow && currentBook !== followed) {
      open.delete(`!b${currentBook}`);
      followed = currentBook;
    }
    const matches = (b) => {
      if (asked) return asked.books.includes(b.id);
      return !query || bookName(b.id).toLowerCase().includes(query) || b.name.toLowerCase().includes(query)
        || b.abbr.some((a) => a.toLowerCase().startsWith(query));
    };

    const groups = ctx.category.testaments.map((t) => ({ t, books: ctx.category.books.filter((b) => b.testament === t.id && matches(b)) }))
      .filter((g) => g.books.length);

    tree.replaceChildren(...groups.map(({ t, books }) => {
      const key = `t${t.id}`;
      // A testament is open unless the reader shuts it: two shut testaments
      // are an empty pane, whatever the reading position is.
      const isOpen = shown(key, true);
      return h('div', { class: `tree-item${isOpen ? ' is-open' : ''}` },
        h('div', {
          class: 'tree-row', role: 'button', tabindex: '0',
          title: names.englishTestament(t.id), 'aria-label': names.englishTestament(t.id),
          onclick: () => { toggle(key, isOpen); paint(); },
        },
          h('span', { class: 'twisty' }, icon('chev')),
          h('span', { class: 'tree-label', lang: names.lang() }, names.testament(t.id)),
          h('span', { class: 'tree-aux' }, names.number(books.length))),
        h('div', { class: 'tree-children' }, books.map((b) => bookRow(b, currentBook, currentChapter, query, asked))));
    }));
  }

  function bookRow(b, currentBook, currentChapter, query, asked = null) {
    const key = `b${b.id}`;
    const isCurrent = b.id === currentBook;
    // A book asked for by name opens at the chapter that was asked for.
    const isOpen = shown(key, (follow && isCurrent && !query) || Boolean(asked));
    // A book this translation does not carry is still listed — it is part of
    // the canon, and another translation may have it — but it is marked, so a
    // reader learns that from the list rather than from an empty chapter.
    const absent = !names.has(b.id);
    const label = absent ? `${names.english(b.id)} — ${L('lbl.notInTranslation')}` : names.english(b.id);
    return h('div', { class: `tree-item is-book${isOpen ? ' is-open' : ''}${isCurrent ? ' is-current' : ''}${absent ? ' is-absent' : ''}` },
      h('div', {
        class: 'tree-row', role: 'button', tabindex: '0',
        title: label, 'aria-label': label,
        onclick: () => { toggle(key, isOpen); paint(); },
      },
        h('span', { class: 'twisty' }, icon('chev')),
        h('span', { class: 'tree-label', lang: names.lang() }, bookName(b.id)),
        // Chapters are read in the translation's own digits, and the column
        // holds chapters throughout — a count in Latin beside a position in
        // Burmese reads as one of them having failed to refresh.
        h('span', { class: 'tree-aux', lang: names.lang() }, isCurrent
          ? `${names.number(currentChapter)}/${names.number(b.chapters)}`
          : names.number(b.chapters))),
      // Each chip carries how long its chapter is, set small under the
      // number: "how much is this" is the question a reader asks before
      // opening one, and the canon already knows the answer.
      h('div', { class: 'tree-children grid' }, Array.from({ length: b.chapters }, (_, i) => {
        const chapter = i + 1;
        const verses = ctx.category.verseCount(b.id, chapter);
        const label = `${names.englishRef(b.id, chapter)} · ${L('lbl.verses', { n: verses })}`;
        // The language reaches the chip because its numerals are the
        // translation's own, and a script whose digits carry stacked marks
        // needs more room than a Latin one to resolve at all.
        return h('button', {
          class: `ch-chip${isCurrent && chapter === currentChapter ? ' is-active' : ''}`,
          title: label, 'aria-label': label, lang: names.lang(),
          onclick: () => onOpen(b.id, chapter),
        },
          h('span', { class: 'cc-n' }, names.number(chapter)),
          counts ? h('span', { class: 'cc-v' }, names.number(verses)) : null);
      })));
  }

  /** What was typed, read as a reference — or null when it is only a filter. */
  function passage(text) {
    if (!/\d/.test(text)) return null;
    const lookup = createLookup({
      category: ctx.category,
      bookName,
      digits: names.digits?.() ?? null,
    });
    const query = parsePassageQuery(text, lookup);
    return query ? { ...query, at: (book) => passageOf(query, book, lookup) } : null;
  }

  /** Open unless the reader shut it; shut unless they opened it. */
  function shown(key, byDefault) {
    if (open.has(key)) return true;
    if (open.has(`!${key}`)) return false;
    return byDefault;
  }

  function toggle(key, isOpen) {
    open.delete(key);
    open.delete(`!${key}`);
    open.add(isOpen ? `!${key}` : key);
  }

  // The two ways this pane can be used are settings like any other, so they are
  // on the settings page as well as on the pane itself.
  ctx.registry.setting({
    id: 'books.follow',
    section: 'study',
    order: 10,
    build: (ui) => [
      ui.toggle({
        name: L('tree.follow'),
        hint: L('set.followHint'),
        value: follow,
        onChange: (on) => {
          follow = on;
          followButton.setAttribute('aria-pressed', String(follow));
          remember();
          paint();
        },
      }),
      ui.toggle({
        name: L('set.chapterCounts'),
        hint: L('set.chapterCountsHint'),
        value: counts,
        onChange: (on) => { counts = on; remember(); paint(); },
      }),
    ],
  });

  return {
    element,
    paint,
    /** Localised book names come from the translation being read. */
    setBookName(fn) { bookName = fn; paint(); },
    /** Where the localised testament name and the script tag come from. */
    setNames(next) { names = next; paint(); },
    collapseAll() { open.clear(); paint(); },
  };
}
