/**
 * The reading surface: one chapter of one translation, as Phase 1 set it —
 * the number large, the caption beside it, then the verses.
 *
 * What the translation data adds over Phase 1: section headings (`story` and
 * `verse.title`), merged verse labels ("17–18"), cross-references, localised
 * digits, and per-translation script direction.
 */

import { verseLabel } from '../core/align.js';
import { strongsRuns } from '../core/strongs.js';
import { VERSE_LAYOUTS } from '../core/settings.js';
import { parseReferences } from '../core/reference.js';
import { localizeNumber } from '../core/translation.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

export const LAYOUTS = VERSE_LAYOUTS;
const LAYOUT_CLASS = { paragraph: '', list: 'list', continuous: 'flow' };

/**
 * @param {{ ctx: object, meta: object, resolver: object, verses: object|null,
 *           book: number, chapter: number, compare: boolean, layout: string,
 *           annotations?: { notes: Map<number, number>, marks: Map<number, object> },
 *           strongs?: boolean, onStrongs?: Function,
 *           primaryVerses?: object|null, onRef: Function, onVerse?: Function,
 *           onRepair?: (identify: string) => void }} p
 * @returns {HTMLElement} .note
 */
export function chapterNote(p) {
  const { ctx, meta, verses, book, chapter, compare, layout } = p;
  const canon = ctx.category.book(book);
  const localBook = meta.books[book];
  const count = verses ? Object.keys(verses).length : 0;

  const caption = compare ? meta.info.name : (localBook?.name ?? canon.name);
  // The translation names the testaments in its own language too; the canon is
  // the fallback, not the first choice.
  const testament = meta.testament?.[canon.testament]?.info?.name
    ?? ctx.category.testaments.find((t) => t.id === canon.testament)?.name;
  const sub = compare
    ? [meta.info.language.text, meta.info.year, L('lbl.verses', { n: count })].filter(Boolean).join(' · ')
    : [testament, meta.info.shortname, L('lbl.verses', { n: count })].filter(Boolean).join(' · ');

  // The script decides the line height and the face, and the browser's own line
  // breaking needs the language: Burmese puts no spaces between words.
  const note = h('div', {
    class: `note${compare ? ' is-compare' : ''}`,
    lang: meta.info.language.code,
    dir: meta.info.language.textdirection,
  },
    h('header', { class: 'ch-head' },
      h('span', { class: 'ch-num', 'aria-hidden': 'true' }, localizeNumber(chapter, meta.digit)),
      h('div', { class: 'ch-meta' },
        h('div', { class: 'ch-caption' }, caption),
        h('div', { class: 'note-sub' }, sub))));

  if (!verses) {
    // Two different things look alike here. A translation that never carried
    // the book is complete and correct; a translation whose own index lists the
    // book but whose text is not in storage was written half-way, and the
    // remedy for that is another download — so they are not worded the same.
    const damaged = Boolean(localBook);
    note.append(h('div', { class: 'callout' },
      h('div', { class: 'co-title' }, icon('alert'),
        h('span', {}, damaged ? L('ch.incomplete') : L('ch.noText', { tr: meta.info.shortname }))),
      h('p', {}, damaged
        ? L('ch.incompleteWhy', { tr: meta.info.name })
        : L('ch.missingBook', { name: canon.name })),
      damaged && p.onRepair
        ? h('button', { class: 'btn', onclick: () => p.onRepair(meta.identify) }, icon('undo'), L('cmd.refreshTranslation'))
        : null));
    return note;
  }

  const keys = Object.keys(verses).map(Number).sort((a, b) => a - b);
  const chapterEl = h('div', {
    class: `chapter ${LAYOUT_CLASS[layout] ?? ''}`.trim(),
    style: { '--vnum-digits': String(String(keys.at(-1) ?? 1).length) },
  });

  // One block per verse: its headings, the verse itself and its references.
  // Parallel alignment and synchronised scrolling measure the block, so a
  // heading in one translation never pushes the other columns out of step.
  for (const key of keys) {
    const verse = verses[key];
    const story = meta.story?.[book]?.[chapter]?.[key];
    const label = localizeNumber(verseLabel(key, verse), meta.digit);

    const mark = p.annotations?.marks.get(key);
    const noteCount = p.annotations?.notes.get(key) ?? 0;
    chapterEl.append(h('div', { class: 'vblock', dataset: { verse: key, span: verse.merge ?? key } },
      story ? h('h2', { class: 'md-h md-h2 story-head' }, story.text) : null,
      verse.title ? h('h3', { class: 'md-h md-h3 verse-title' }, verse.title) : null,
      h('p', {
        class: `verse${mark ? ' is-marked' : ''}`, id: `v${key}`,
        dataset: mark?.colour ? { colour: mark.colour } : undefined,
      },
        // Shift takes the passage between the verse already chosen and this
        // one — the way a run of anything is chosen everywhere else.
        h('button', {
          class: 'vnum', type: 'button',
          onclick: (e) => p.onVerse?.(key, e.currentTarget, { extend: e.shiftKey }),
        }, label),
        verseText(verse.text, p),
        noteCount ? h('button', {
          class: 'verse-note-dot', title: L('lbl.notes', { n: noteCount }), 'aria-label': L('lbl.notes', { n: noteCount }),
          onclick: (e) => p.onVerse?.(key, e.currentTarget, { extend: e.shiftKey }),
        }, icon('note')) : null),
      verse.ref && !compare ? refsLine(verse.ref, meta, p.resolver, p.onRef) : null));
  }
  note.append(chapterEl);

  // Verses the primary pane has and this translation does not.
  if (compare && p.primaryVerses) {
    const here = new Set(coveredVerses(verses));
    const gap = coveredVerses(p.primaryVerses).filter((n) => !here.has(n));
    if (gap.length) note.append(h('p', { class: 'tr-missing' }, L('lbl.missingHere', { list: ranges(gap) })));
  }
  return note;
}

/**
 * Verse text, with Strong's numbers marked where the translation carries them.
 * No published translation does today, so this normally returns the text as is.
 */
function verseText(text, p) {
  const runs = strongsRuns(text);
  if (runs.length === 1 && runs[0].code === null) return runs[0].text;
  return runs.map((run) => (run.code === null ? run.text : h('span', {
    class: `strongs${p.strongs ? '' : ' is-hidden-code'}`, dataset: { code: run.code },
    title: run.code,
    onclick: (e) => p.onStrongs?.(run.code, e.currentTarget),
  }, run.text, p.strongs ? h('sup', { class: 'strongs-code' }, run.code) : null)));
}

function refsLine(text, meta, resolver, onRef) {
  const parts = parseReferences(text, resolver, { digit: meta.digit });
  return h('p', { class: 'xrefs' }, parts.map((part, i) => [
    i > 0 ? ' · ' : null,
    part.refs
      ? h('button', { class: 'xref', type: 'button', onclick: () => onRef(part.refs[0]) }, part.text)
      : h('span', { class: 'xref-plain', title: `Unresolved reference: ${part.unresolved}` }, part.text),
  ]));
}

function coveredVerses(verses) {
  const out = [];
  for (const [key, v] of Object.entries(verses)) {
    for (let n = Number(key); n <= (v.merge ?? Number(key)); n += 1) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** [1,2,3,7] → "1–3, 7" */
export function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i += 1) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    out.push(j > i ? `${nums[i]}–${nums[j]}` : String(nums[i]));
    i = j;
  }
  return out.join(', ');
}
