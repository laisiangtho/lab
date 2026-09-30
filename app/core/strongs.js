/**
 * Strong's numbers embedded in verse text.
 *
 * A translation stores them inline, after the word they belong to, in the
 * notation the importers write (`beginning{H7225}`). The other notations the
 * common public editions use are read as well:
 *
 *   {H7225}  {G0026}      brace form (e-Sword, MySword, this app)
 *   <S>430</S>            tag form (Bible SuperSearch)
 *   [H430]                bracket form
 *
 * A number may carry one letter after it — `H1254a`, `H1961G` — which is how
 * the extended editions (STEPBible's TAHOT and TAGNT among them) tell apart
 * the senses Strong numbered once.
 *
 * ## Strong's, and numbers that only look like Strong's
 *
 * Strong's Hebrew runs from H1 to H8674 and the Greek from G1 to G5624. A
 * tagged edition may also use numbers past those ends: STEPBible writes
 * prefixes and suffixes as H9001 upward, and eBible.org's tagged Judson Bible
 * marks the words that have no Hebrew or Greek behind them — the particles
 * Burmese needs and the source does not have — as H9999. Those are the
 * edition's own numbers. No Strong's lexicon has an entry for them, so they are
 * kept in the stored text (an export still carries them) but never shown as a
 * link that leads nowhere, and `tallyStrongs` counts them so the translation
 * can say what it carries.
 *
 * ## Where the markup is shown
 *
 * Only on the reading surface, and only with Strong's numbers switched on.
 * Everything else — cards, search, reading aloud, copying, the verse of the
 * day — reads `plainText`, which the store returns by default
 * (`store.getChapter`), so a feature has to ask for the markup to get it.
 */

// Built fresh per use: a shared /g regex carries lastIndex between calls, so
// a test() would move where the next matchAll() starts.
const CODE = String.raw`[HG]?\d{1,5}[A-Za-z]?`;
const TOKEN_SOURCE = String.raw`\{(${CODE})\}|<S>(${CODE})<\/S>|\[([HG]\d{1,5}[A-Za-z]?)\]`;
const tokens = () => new RegExp(TOKEN_SOURCE, 'g');

/** The last number in each of Strong's two lexicons. */
export const STRONGS_LAST = Object.freeze({ H: 8674, G: 5624 });

/**
 * @param {string} text
 * @returns {{ text: string, codes: {code: string, at: number}[] }}
 *          `text` without the markup, and each code with the offset, in that
 *          text, of the end of the word it belongs to
 */
export function extractStrongs(text) {
  if (!hasStrongs(text)) return { text, codes: [] };
  const codes = [];
  let out = '';
  let last = 0;
  // Where a code stood between two spaces ("word {H430} next"), the second
  // space is dropped as the text is joined — not afterwards, which would move
  // every offset already recorded.
  const append = (piece) => { out += /\s$/u.test(out) ? piece.replace(/^[^\S\n]+/u, '') : piece; };
  for (const match of text.matchAll(tokens())) {
    append(text.slice(last, match.index));
    // "word {H430}" belongs to "word", not to the space after it.
    codes.push({ code: normalizeCode(match[1] ?? match[2] ?? match[3]), at: out.replace(/\s+$/u, '').length });
    last = match.index + match[0].length;
  }
  append(text.slice(last));
  return { text: out.trimEnd(), codes };
}

export function hasStrongs(text) {
  return tokens().test(text);
}

/** Verse text without its markup: what every surface but the reading one shows. */
export function plainText(text) {
  const value = String(text ?? '');
  return hasStrongs(value) ? extractStrongs(value).text : value;
}

/**
 * A chapter's verses with their text made plain. The same object comes back
 * when nothing in it is marked, which is every chapter of most translations.
 *
 * @param {Record<string, { text: string }>} verses
 */
export function plainVerses(verses) {
  if (!verses) return verses;
  const marked = Object.values(verses).some((verse) => hasStrongs(String(verse?.text ?? '')));
  if (!marked) return verses;
  return Object.fromEntries(Object.entries(verses).map(([key, verse]) => [key, { ...verse, text: plainText(verse.text) }]));
}

/**
 * "h0430" → "H430", "H1254a" → "H1254A", "0026" → "26". A bare number keeps
 * its form: whether 26 is Hebrew or Greek is unknowable from the number.
 */
export function normalizeCode(code) {
  const found = /^([HG]?)0*(\d+)([A-Z]?)$/i.exec(String(code).trim());
  if (!found) throw new Error(`strongs: "${code}" is not a Strong's number`);
  return `${found[1].toUpperCase()}${found[2] || '0'}${found[3].toUpperCase()}`;
}

/**
 * Whether a code is one of Strong's own, or a number an edition added past the
 * end of the lexicon (see the module comment). A bare number is Strong's:
 * without its letter there is no end to be past.
 *
 * @returns {'strongs'|'edition'}
 */
export function kindOf(code) {
  const found = /^([HG]?)(\d+)/.exec(normalizeCode(code));
  const n = Number(found[2]);
  if (!found[1]) return n >= 1 ? 'strongs' : 'edition';
  return n >= 1 && n <= STRONGS_LAST[found[1]] ? 'strongs' : 'edition';
}

/**
 * Split text into runs so each word that carries a Strong's number can be
 * wrapped. A word with several numbers is one run carrying all of them; the
 * edition's own numbers (`kindOf`) are left off, since nothing can be looked
 * up for them — unless `all` is asked for, which a writer does: a file written
 * out keeps everything the translation carries.
 *
 * @returns {{ text: string, code: string|null, codes: string[] }[]}
 */
export function strongsRuns(text, { all = false } = {}) {
  const { text: clean, codes } = extractStrongs(String(text ?? ''));
  const wanted = (code) => all || kindOf(code) === 'strongs';
  if (!codes.some(({ code }) => wanted(code))) return [{ text: clean, code: null, codes: [] }];

  const runs = [];
  let from = 0;
  let lastAt = -1;
  for (const { code, at } of codes) {
    const shown = wanted(code);
    // Another number on the word just read.
    if (at === lastAt) {
      const previous = runs[runs.length - 1];
      if (!shown) continue;
      if (previous?.code) { previous.codes.push(code); continue; }
      // The word's first number was the edition's own; this one is Strong's.
      previous.code = code;
      previous.codes = [code];
      continue;
    }
    // The number belongs to the word ending at `at`: back to the last space,
    // but never into text already given to another word — scripts written
    // without spaces put one tagged word straight after another. An edition
    // number still ends a word, or its word would be taken by the next one.
    const wordStart = Math.max(clean.lastIndexOf(' ', Math.max(at - 1, 0)) + 1, from);
    if (wordStart > from) runs.push({ text: clean.slice(from, wordStart), code: null, codes: [] });
    runs.push(shown ? { text: clean.slice(wordStart, at), code, codes: [code] } : { text: clean.slice(wordStart, at), code: null, codes: [] });
    from = at;
    lastAt = at;
  }
  if (from < clean.length) runs.push({ text: clean.slice(from), code: null, codes: [] });
  return runs.filter((run) => run.text !== '');
}

/**
 * Count what a text carries, into `into` (created when not given):
 * `{ words, edition: { code: count } }` — how many words carry a Strong's
 * number, and how often each of the edition's own numbers appears.
 */
export function tallyStrongs(text, into = { words: 0, edition: {} }) {
  const { codes } = extractStrongs(String(text ?? ''));
  let lastAt = -1;
  for (const { code, at } of codes) {
    if (kindOf(code) === 'strongs') {
      if (at !== lastAt) into.words += 1;
      lastAt = at;
    } else {
      into.edition[code] = (into.edition[code] ?? 0) + 1;
    }
  }
  return into;
}

/**
 * The few edition numbers worth naming, most frequent first:
 * `[["H9999", 5210], …]`.
 */
export function editionCodes(tally, limit = 3) {
  return Object.entries(tally?.edition ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

/**
 * Every Strong's number in a text, with where the word it belongs to sits in
 * the plain text: what a search for "H430" highlights.
 *
 * @returns {{ code: string, from: number, to: number }[]}
 */
export function codeRanges(text) {
  const out = [];
  let offset = 0;
  for (const run of strongsRuns(text)) {
    for (const code of run.codes) out.push({ code, from: offset, to: offset + run.text.length });
    offset += run.text.length;
  }
  return out;
}
