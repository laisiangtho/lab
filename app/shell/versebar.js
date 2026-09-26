/**
 * The verse bar: a small popover under a verse number, holding whatever
 * actions features registered. The shell owns the bar; features own the
 * actions, so a build without bookmarks simply has fewer buttons.
 *
 * A passage may be more than one verse. Pressing a verse number chooses that
 * verse; pressing another with Shift held takes everything between the two,
 * whichever order they were pressed in. What is chosen is tinted while the bar
 * is open, and every action is handed `{ book, chapter, verse, to }` — a note
 * on five verses is one note, not five.
 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

export function createVerseBar(ctx) {
  const label = h('div', { class: 'vbar-ref' });
  const actions = h('div', { class: 'vbar-acts' });
  const bar = h('div', { class: 'popover vbar', hidden: true }, label, actions);
  /** @type {{ book:number, chapter:number, verse:number, to:number|null } | null} */
  let open = null;
  let lastAnchor = null;

  document.addEventListener('pointerdown', (e) => {
    if (!bar.hidden && !bar.contains(e.target) && !e.target.closest('.vnum')) close();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', close);

  function close() {
    bar.hidden = true;
    open = null;
    lastAnchor = null;
    paintSelection([]);
  }

  /** Tint the verses a passage covers, and nothing else. */
  function paintSelection(verses) {
    const wanted = new Set(verses);
    for (const el of document.querySelectorAll('.verse')) {
      const verse = Number(el.closest('.vblock')?.dataset.verse);
      el.classList.toggle('is-selected', wanted.has(verse));
    }
  }

  function show(anchor, passage, { extend = false } = {}) {
    const same = open && open.book === passage.book && open.chapter === passage.chapter;
    if (extend && same) {
      // The run is from the verse already chosen to this one, in either
      // direction; the anchor stays where the reader started.
      const first = Math.min(open.verse, passage.verse);
      const last = Math.max(open.to ?? open.verse, passage.verse);
      open = { ...passage, verse: first, to: last === first ? null : last };
      anchor = lastAnchor ?? anchor;
    } else if (same && open.verse === passage.verse && open.to === null && !bar.hidden) {
      close();
      return;
    } else {
      open = { ...passage, to: null };
      lastAnchor = anchor;
    }

    const here = open;
    const ref = ctx.shell.workspace.englishRef(here.book, here.chapter);
    const span = here.to ? `${here.verse}–${here.to}` : String(here.verse);
    label.textContent = `${ref}:${span}`;
    label.title = L('lbl.selectHint');

    actions.replaceChildren(...ctx.registry.verseActions().map((action) => {
      const title = typeof action.title === 'function' ? action.title(here) : action.title;
      return h('button', {
        'aria-pressed': action.isOn ? String(Boolean(action.isOn(here))) : null,
        title, 'aria-label': title,
        onclick: async () => {
          close();
          await action.run(here);
        },
      }, icon(typeof action.icon === 'function' ? action.icon(here) : action.icon));
    }));

    bar.hidden = false;
    paintSelection(rangeOf(here));
    place(anchor);
  }

  function rangeOf({ verse, to }) {
    const out = [];
    for (let v = verse; v <= (to ?? verse); v += 1) out.push(v);
    return out;
  }

  function place(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = bar.offsetWidth;
    const left = Math.min(Math.max(rect.left - 6, 8), window.innerWidth - width - 8);
    const below = rect.bottom + 6;
    const above = rect.top - bar.offsetHeight - 6;
    const fitsBelow = below + bar.offsetHeight < window.innerHeight - 8;
    bar.style.left = `${left}px`;
    bar.style.top = `${fitsBelow ? below : Math.max(above, 8)}px`;
  }

  return { element: bar, show, close };
}
