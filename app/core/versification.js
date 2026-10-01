/**
 * Verse numbers across the two numberings of the Old Testament.
 *
 * English Bibles number the Old Testament as the KJV does; the Hebrew Bible
 * (the Westminster Leningrad Codex, BHS, and every original made from them)
 * numbers it otherwise in some 2,000 verses: Malachi 4:1 is Hebrew 3:19, a
 * psalm's title is Hebrew verse 1, Joel 2:28 is Hebrew 3:1. Reading one text
 * against the other by verse number — the word study, the interlinear line —
 * has to go through this, or Malachi 4 is matched with nothing.
 *
 * The table (versification-data.js) is generated from STEPBible's TVTMS by
 * scripts/versification.mjs. The New Testament numbers alike in both.
 *
 * Pure.
 */

import { ENGLISH_TO_HEBREW } from './versification-data.js';

export const NUMBERINGS = Object.freeze(['english', 'hebrew']);

/** Hebrew "book.chapter.verse" → the English verses that are it. Built once, when first asked. */
let reverse = null;
function hebrewToEnglish() {
  if (reverse) return reverse;
  reverse = {};
  for (const [english, targets] of Object.entries(ENGLISH_TO_HEBREW)) {
    const [book, chapter, verse] = english.split('.');
    for (const target of targets) {
      const key = `${book}.${target}`;
      (reverse[key] ??= []).push(`${chapter}.${verse}`);
    }
  }
  return reverse;
}

/**
 * A verse in one numbering, as the verses it is in another.
 *
 * @param {{ book: number, chapter: number, verse: number }} ref
 * @param {'english'|'hebrew'} from the numbering `ref` is in
 * @param {'english'|'hebrew'} to the numbering wanted
 * @returns {{ book: number, chapter: number, verse: number }[]} one verse
 *          for most; several where one verse is two in the other numbering
 *          (a psalm title); the same verse where the numberings agree
 */
export function mapVerse({ book, chapter, verse }, from, to) {
  for (const numbering of [from, to]) {
    if (!NUMBERINGS.includes(numbering)) throw new Error(`versification: no numbering "${numbering}" (expected english or hebrew)`);
  }
  const same = [{ book, chapter, verse }];
  if (from === to || book > 39) return same;
  const table = from === 'english' ? ENGLISH_TO_HEBREW : hebrewToEnglish();
  const found = table[`${book}.${chapter}.${verse}`];
  if (!found) return same;
  return found.map((at) => {
    const [c, v] = at.split('.').map(Number);
    return { book, chapter: c, verse: v };
  });
}

/**
 * Which numbering a text follows, from which chapters it has: only an
 * English-numbered Bible has a Malachi 4, only a Hebrew-numbered one a
 * Joel 4. A text with neither — a portion, a New Testament — follows its
 * language: a Hebrew text the Hebrew numbering, anything else the English.
 *
 * @param {(book: number, chapter: number) => boolean} has whether the text has a chapter
 * @param {{ hebrew?: boolean }} [options] whether the text is in Hebrew
 * @returns {'english'|'hebrew'}
 */
export function numberingOf(has, { hebrew = false } = {}) {
  if (has(39, 4)) return 'english';
  if (has(29, 4)) return 'hebrew';
  return hebrew ? 'hebrew' : 'english';
}
