/**
 * The breadcrumb picker: press a crumb and its siblings appear under it — the
 * testament's books, or the book's chapters — as a grid pinned to the crumb it
 * came from.
 *
 * One element, repainted in place: choosing a book moves to that book's
 * chapters without moving the arrow, so the picker keeps pointing at where it
 * was opened from. A chapter the current translation actually carries is marked,
 * so gaps in a translation are visible before opening one.
 */

import { h } from './dom.js';
import { L } from './i18n.js';

const PAD = 8;
const GAP = 4;
/** How far the arrow stays from either end: past the corner's radius. */
const ARROW_INSET = 22;
const EDGE = 8;

export function createNavPop(ctx, { bookName, lang, number, english, englishRef }) {
  const grid = h('div', { class: 'np-grid' });
  const element = h('div', { class: 'navpop', role: 'dialog', hidden: true }, grid);
  let anchor = null;
  let onPick = null;
  let present = new Set(); // chapters the translation has, for the book on show

  document.addEventListener('pointerdown', (e) => {
    if (element.hidden || element.contains(e.target) || e.target === anchor) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (!element.hidden && e.key === 'Escape') { close(true); e.stopPropagation(); }
  });
  window.addEventListener('resize', () => { if (!element.hidden) place(); });

  /**
   * @param {HTMLElement} from the crumb pressed
   * @param {'books'|'chapters'} mode
   * @param {{ book: number, chapter: number }} at where the reader is now
   * @param {(book: number, chapter: number) => void} go
   */
  async function open(from, mode, at, go) {
    if (anchor === from && !element.hidden) { close(true); return; } // the crumb toggles its picker
    anchor = from;
    onPick = go;
    from.setAttribute('aria-expanded', 'true');
    await paint(mode, at);
  }

  function close(restoreFocus = false) {
    if (element.hidden) return;
    element.hidden = true;
    const previous = anchor;
    anchor = null;
    if (!previous) return;
    previous.setAttribute('aria-expanded', 'false');
    if (restoreFocus && previous.isConnected) previous.focus();
  }

  async function paint(mode, at) {
    const { category } = ctx;
    const canon = category.book(at.book);

    if (mode === 'books') {
      const books = category.books.filter((b) => b.testament === canon.testament);
      grid.replaceChildren(...books.map((b) => h('button', {
        class: `np-book${b.id === at.book ? ' is-active' : ''}`,
        title: english(b.id), 'aria-label': english(b.id),
        tabindex: b.id === at.book ? '0' : '-1',
        onclick: () => paint('chapters', { book: b.id, chapter: b.id === at.book ? at.chapter : 0 }),
      },
        // Numbered by canon order, so the list reads as the sequence it is.
        h('span', { class: 'np-n' }, number(b.id)),
        h('span', { class: 'np-name', lang: lang() }, bookName(b.id)))));
      element.className = 'navpop is-books';
      element.setAttribute('aria-label', category.testaments.find((t) => t.id === canon.testament)?.name ?? '');
    } else {
      present = await chaptersPresent(at.book);
      const book = category.book(at.book);
      grid.replaceChildren(...Array.from({ length: book.chapters }, (_, i) => i + 1).map((n) => h('button', {
        class: `ch-chip${present.has(n) ? ' has-text' : ''}${n === at.chapter ? ' is-active' : ''}`,
        title: englishRef(at.book, n), 'aria-label': englishRef(at.book, n),
        tabindex: n === at.chapter || (!at.chapter && n === 1) ? '0' : '-1',
        onclick: () => { const go = onPick; close(); go?.(at.book, n); },
      }, number(n))));
      element.className = 'navpop is-chapters';
      element.setAttribute('aria-label', L('lbl.chaptersOf', { book: bookName(at.book) }));
    }

    grid.scrollTop = 0;
    element.hidden = false;
    place();
    const focus = grid.querySelector('[tabindex="0"]') ?? grid.firstElementChild;
    if (focus) {
      try { focus.scrollIntoView({ block: 'center' }); } catch { /* not scrollable yet */ }
      focus.focus({ preventScroll: true });
    }
  }

  /** Which chapters of a book the translation in view actually carries. */
  async function chaptersPresent(book) {
    const { state, store, category } = ctx;
    const { translation } = state.get();
    if (!translation) return new Set();
    const found = new Set();
    const total = category.book(book).chapters;
    const checks = await Promise.all(
      Array.from({ length: total }, (_, i) => store.getChapter(translation, book, i + 1).then((v) => (v ? i + 1 : 0), () => 0)),
    );
    for (const n of checks) if (n) found.add(n);
    return found;
  }

  /** Sized to whole columns, pinned under the crumb and kept on screen. */
  function place() {
    if (!anchor || element.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const books = element.classList.contains('is-books');
    const cell = books ? 168 : 40;
    const count = grid.children.length;
    const columns = books
      ? Math.min(3, Math.max(1, count))
      : Math.min(10, Math.max(4, Math.ceil(Math.sqrt(count))));
    const width = Math.min(columns * cell + (columns - 1) * GAP + PAD * 2, window.innerWidth - EDGE * 2);
    // Centred on the crumb, not aligned to its left edge. A crumb is often one
    // or two characters wide — a chapter number — and a box whose left edge
    // starts there leaves the arrow jammed into the corner, pointing at a
    // rounded edge instead of at the button that opened it.
    const middle = rect.left + rect.width / 2;
    const left = Math.max(EDGE, Math.min(middle - width / 2, window.innerWidth - width - EDGE));
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    element.style.width = `${width}px`;
    element.style.left = `${left}px`;
    // The arrow points at the crumb this was opened from, wherever it sits —
    // but never into a rounded corner, where it has no straight edge to stand
    // on and reads as missing.
    const centre = Math.round(middle - left);
    const reach = Math.min(Math.max(centre, ARROW_INSET), width - ARROW_INSET);
    element.style.setProperty('--arrow-x', `${reach}px`);
    // A crumb scrolled out from under the box has nothing to point at, and an
    // arrow standing over empty space reads as a fault.
    element.classList.toggle('no-arrow', Math.abs(reach - centre) > rect.width / 2 + 2);

    // Below the crumb when there is room for it, above when there is not.
    const below = window.innerHeight - rect.bottom - EDGE;
    const height = Math.min(element.scrollHeight || 320, Math.max(below, rect.top - EDGE));
    const above = below < 180 && rect.top > below;
    element.classList.toggle('is-above', above);
    element.style.maxHeight = `${Math.max(140, above ? rect.top - EDGE * 2 : below)}px`;
    element.style.top = above ? `${Math.max(EDGE, rect.top - height - 8)}px` : `${rect.bottom + 8}px`;
  }

  return { element, open, close, get isOpen() { return !element.hidden; } };
}
