/**
 * A translation's Strong's numbers, gathered: for each number, every word the
 * translation uses for it, how often, and where.
 *
 * This is the app's own version of browserBible's `indexlemma` (a number and
 * the verses it is in) with the one thing that index lacks and a reader wants
 * most — the words. "H430" in a Burmese Bible is not a list of verse numbers;
 * it is ဘုရားသခင် 2,300 times, ဘုရား 12 times, and which verses are which.
 * It is built from the text the app keeps, so it cannot disagree with it.
 *
 *   {
 *     version: <the translation's version, so a reinstall rebuilds it>,
 *     codes: {
 *       "H430": { n: 2602, words: { "ဘုရားသခင်": { n: 2591, refs: ["1.1.1", …] }, … } },
 *       …
 *     }
 *   }
 *
 * A reference is "book.chapter.verse", once a verse even when a word is
 * repeated in it. The words are as the text has them, punctuation trimmed
 * from their ends and Hebrew cantillation taken out: "God" and "god" are kept apart, since a translation that
 * capitalises one and not the other means something by it.
 *
 * Pure.
 */

import { kindOf, strongsRuns } from './strongs.js';

/** Punctuation and spaces at either end of a word. */
const EDGES = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu;

/**
 * The Hebrew Bible's cantillation: accents for chanting (U+0591–U+05AF), the
 * meteg (U+05BD) and the paseq (U+05C0). They say how a word is sung where it
 * stands, not which word it is, so בָּרָ֣א and בָּרָ֥א are one rendering.
 * Vowel points stay: they are the word.
 */
const CANTILLATION = /[\u0591-\u05AF\u05BD\u05C0]/g;

/** A word as an index keeps it. */
export const wordKey = (text) => String(text ?? '').replace(CANTILLATION, '').replace(EDGES, '').normalize('NFC');

/** Bumped when what an index holds changes, so a kept one is rebuilt. */
export const INDEX_FORMAT = 2;

/**
 * @param {Iterable<{ book: number, chapter: number, verses: Record<string, { text: string }> }>} rows
 *        chapters with their markup (store.scanChapters gives exactly this)
 * @param {{ version?: number }} [options]
 */
export function buildLemmaIndex(rows, { version = 0 } = {}) {
  const index = { version, codes: {} };
  for (const row of rows) addChapter(index, row);
  return index;
}

/** One chapter into an index being built. */
export function addChapter(index, { book, chapter, verses }) {
  for (const [n, verse] of Object.entries(verses ?? {})) {
    const ref = `${book}.${chapter}.${n}`;
    for (const run of strongsRuns(String(verse?.text ?? ''))) {
      if (!run.codes.length) continue;
      const word = wordKey(run.text);
      if (!word) continue;
      for (const code of run.codes) {
        if (kindOf(code) !== 'strongs') continue;
        const entry = index.codes[code] ??= { n: 0, words: {} };
        entry.n += 1;
        const said = entry.words[word] ??= { n: 0, refs: [] };
        said.n += 1;
        if (said.refs[said.refs.length - 1] !== ref) said.refs.push(ref);
      }
    }
  }
  return index;
}

/**
 * The words a translation uses for a number, most used first. A number
 * without a sense letter gathers every sense of it ("H1254" is H1254A and
 * H1254B together); one with a letter is that sense alone.
 *
 * @returns {{ code: string, n: number, words: { word: string, n: number, refs: string[] }[] }}
 */
export function renderings(index, code) {
  const wanted = String(code ?? '').toUpperCase();
  const base = wanted.replace(/[A-Z]$/, '');
  const exact = base !== wanted;
  const merged = new Map();
  let n = 0;
  for (const [key, entry] of Object.entries(index?.codes ?? {})) {
    if (exact ? key !== wanted : key.replace(/[A-Z]$/, '') !== base) continue;
    n += entry.n;
    for (const [word, said] of Object.entries(entry.words)) {
      const into = merged.get(word) ?? { word, n: 0, refs: [] };
      into.n += said.n;
      into.refs.push(...said.refs);
      merged.set(word, into);
    }
  }
  const words = [...merged.values()]
    .map((w) => ({ ...w, refs: [...new Set(w.refs)].sort(byRef) }))
    .sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  return { code: wanted, n, words };
}

/** "1.2.3" order, as numbers. */
export function byRef(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** "43.3.16" → { book: 43, chapter: 3, verse: 16 } */
export function parseRef(ref) {
  const [book, chapter, verse] = String(ref).split('.').map(Number);
  return { book, chapter, verse };
}

/**
 * The words of an original-language verse that carry a number, with their
 * morphology: what the interlinear line and the word study show.
 *
 * @param {string} text the original verse, with its markup
 * @returns {{ word: string, codes: string[], morphs: (string|null)[] }[]}
 */
export function taggedWords(text) {
  return strongsRuns(String(text ?? ''), { all: true })
    .filter((run) => run.codes.length)
    .map((run) => ({ word: run.text.replace(EDGES, '') || run.text, codes: run.codes, morphs: run.morphs }));
}

/**
 * Whether two codes name the same word: equal, or one is the other without
 * its sense letter (a translation tagged with H1254 matches a Hebrew text's
 * H1254A).
 */
export function sameNumber(a, b) {
  const x = String(a).toUpperCase();
  const y = String(b).toUpperCase();
  if (x === y) return true;
  const bx = x.replace(/[A-Z]$/, '');
  const by = y.replace(/[A-Z]$/, '');
  return bx === by && (bx === x || by === y);
}
