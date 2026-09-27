/**
 * A reference, read without going there.
 *
 * Following a cross-reference is usually a question, not a decision: *what does
 * that one say?* Answering it by replacing the chapter on screen means the
 * reader loses their place to satisfy a moment's curiosity, and then has to
 * find their way back — which is why people stop following references at all.
 * So a reference can now be read where it stands, and going there is something
 * they choose afterwards rather than something that has already happened.
 *
 * What this is not: a hover card that appears while the pointer crosses a
 * paragraph. It waits, it is cancelled the moment the pointer leaves, and on a
 * device with no real pointer it does not exist — the caller decides that
 * (`reflink.js`), because a popover that follows a finger is a popover in the
 * way of the text it is quoting.
 *
 * The verses come from the store the reader is already reading from, so a peek
 * costs one keyed read against a database that is local by definition, and the
 * last few are kept so that running an eye down a column of references does not
 * read the same chapter five times.
 */

import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

const EDGE = 8;
const ARROW_INSET = 22;
const WIDTH = 380;
/** How many chapters to keep. Small: this is a convenience, not a cache layer. */
const KEEP = 6;

/**
 * @param {object} ctx the app context — `store` and `state` for the text
 * @param {{ bookName: (book: number) => string, number: (n: number) => string,
 *           lang: () => string, direction: () => string,
 *           go: (ref: object, options: object) => void }} deps
 */
export function createPeek(ctx, { bookName, number, lang, direction, go }) {
  const body = h('div', { class: 'pk-body' });
  const foot = h('div', { class: 'pk-foot' });
  const element = h('div', { class: 'navpop peek', role: 'dialog', hidden: true }, body, foot);
  let anchor = null;
  let showing = null;
  /** The last few chapters read, newest last. */
  const held = [];
  let token = 0;

  document.addEventListener('pointerdown', (e) => {
    if (element.hidden || element.contains(e.target) || e.target === anchor) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (!element.hidden && e.key === 'Escape') { close(); e.stopPropagation(); }
  });
  window.addEventListener('resize', () => { if (!element.hidden) place(); });
  // A peek is pinned to something in the text. Scroll that away and it is
  // pointing at nothing, which reads worse than it disappearing.
  window.addEventListener('wheel', () => { if (!element.hidden) close(); }, { passive: true });

  async function chapterOf(translation, book, chapter) {
    const key = `${translation}/${book}/${chapter}`;
    const found = held.find((row) => row.key === key);
    if (found) return found.verses;
    const verses = await ctx.store.getChapter(translation, book, chapter);
    held.push({ key, verses });
    if (held.length > KEEP) held.shift();
    return verses;
  }

  /**
   * Show a reference under the element that names it.
   *
   * @param {HTMLElement} from
   * @param {{ book: number, chapter: number, verse?: number|null, to?: number|null }} ref
   */
  async function open(from, ref) {
    const { translation } = ctx.state.get();
    if (!translation) return;
    const mine = ++token;
    anchor = from;
    showing = ref;

    let verses = null;
    try {
      verses = await chapterOf(translation, ref.book, ref.chapter);
    } catch {
      // A chapter that cannot be read is not worth an error toast for a
      // gesture the reader did not commit to; the peek simply says so.
      verses = null;
    }
    if (mine !== token) return;

    const label = `${bookName(ref.book)} ${number(ref.chapter)}${ref.verse ? `:${number(ref.verse)}${ref.to && ref.to !== ref.verse ? `–${number(ref.to)}` : ''}` : ''}`;
    const from1 = ref.verse ?? 1;
    const to = ref.to ?? ref.verse ?? null;
    const numbers = Object.keys(verses ?? {}).map(Number)
      .filter((n) => n >= from1 && (to === null ? n < from1 + 4 : n <= to))
      .sort((a, b) => a - b);

    fill(body,
      h('p', { class: 'pk-ref' }, label),
      numbers.length
        ? h('div', { class: 'pk-text', lang: lang(), dir: direction() },
          numbers.map((n) => h('p', { class: 'pk-v' },
            h('span', { class: 'pk-n' }, number(n)),
            verses[n].text)))
        : h('p', { class: 'pk-empty' }, L('peek.nothing')));

    fill(foot,
      h('button', {
        class: 'pk-act', onclick: () => { close(); go(ref, {}); },
      }, icon('arrow-right'), L('peek.open')),
      h('button', {
        class: 'pk-act', onclick: () => { close(); go(ref, { newTab: true }); },
      }, icon('add-pane'), L('peek.newTab')));

    element.hidden = false;
    place();
  }

  function close() {
    token++;
    if (element.hidden) return;
    element.hidden = true;
    anchor = null;
    showing = null;
  }

  function place() {
    if (!anchor || element.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
    const middle = rect.left + rect.width / 2;
    const left = Math.max(EDGE, Math.min(middle - width / 2, window.innerWidth - width - EDGE));
    element.style.width = `${width}px`;
    element.style.left = `${left}px`;

    const centre = Math.round(middle - left);
    const reach = Math.min(Math.max(centre, ARROW_INSET), width - ARROW_INSET);
    element.style.setProperty('--arrow-x', `${reach}px`);
    element.classList.toggle('no-arrow', Math.abs(reach - centre) > rect.width / 2 + 2);

    const below = window.innerHeight - rect.bottom - EDGE;
    const above = below < 200 && rect.top > below;
    const room = Math.max(140, above ? rect.top - EDGE * 2 : below - EDGE);
    element.style.maxHeight = `${room}px`;
    element.classList.toggle('is-above', above);
    element.style.top = above
      ? `${Math.max(EDGE, rect.top - Math.min(element.scrollHeight || 240, room) - 8)}px`
      : `${rect.bottom + 8}px`;
  }

  return {
    element,
    open,
    close,
    get isOpen() { return !element.hidden; },
    get showing() { return showing; },
  };
}
