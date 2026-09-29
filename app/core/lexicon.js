/**
 * A Strong's lexicon: what a number means.
 *
 * The app has read Strong's numbers out of the text since Phase 1 and has never
 * had anything to say about them — the popover printed the code and the
 * sentence "No lexicon is installed." This is the shape of the file that fixes
 * that, and the rules for reading one.
 *
 * ## The file
 *
 * One per testament, keyed by the code without its letter, because the letter
 * is the file:
 *
 *   {
 *     "app": "lai-siangtho", "kind": "lexicon", "schema": 1,
 *     "testament": "H",
 *     "name": "Strong's Hebrew Dictionary",
 *     "source": "public domain, from the 1890 edition",
 *     "entry": {
 *       "7225": {
 *         "lemma": "רֵאשִׁית",
 *         "translit": "rêʼshîyth",
 *         "pronounce": "ray-sheeth'",
 *         "part": "noun feminine",
 *         "define": "the first, in place, time, order or rank",
 *         "kjv": "beginning, chief(-est), first(-fruits, part, time), principal thing"
 *       }
 *     }
 *   }
 *
 * Every field but `define` is optional, and an entry may also be a bare string,
 * which is taken as its definition. That is deliberate: the public-domain
 * Strong's data in circulation comes in a dozen shapes, and a lexicon that
 * refuses to load because it has no transliteration field would be a lexicon
 * nobody could assemble.
 *
 * Pure. The fetching and the storing are in `services/lexicon.js`.
 */

import { expectObject, fail, isPlainObject } from './errors.js';

export const LEXICON_SCHEMA = 1;
/** Which testament a code belongs to: Hebrew for the Old, Greek for the New. */
export const TESTAMENTS = Object.freeze(['H', 'G']);

/**
 * @typedef {{ lemma: string, translit: string, pronounce: string, part: string,
 *             define: string, kjv: string }} LexEntry
 */

/**
 * Read a lexicon file.
 *
 * Strict about what it is — a file that is not one of ours is refused by name,
 * as every other import here is — and lenient about what is in it, because the
 * entries come from a dozen transcriptions of a book from 1890.
 *
 * @param {unknown} raw
 * @param {{ source: string }} options
 * @returns {{ testament: string, name: string, source: string, entries: Record<string, LexEntry> }}
 */
export function parseLexicon(raw, { source }) {
  expectObject(raw, source, '$');
  if (raw.app !== 'lai-siangtho') fail(source, '$.app', `expected "lai-siangtho", got ${JSON.stringify(raw.app)}`);
  if (raw.kind !== 'lexicon') fail(source, '$.kind', `expected "lexicon", got ${JSON.stringify(raw.kind)}`);
  if (raw.schema !== LEXICON_SCHEMA) {
    fail(source, '$.schema', `this build reads schema ${LEXICON_SCHEMA}, the file says ${JSON.stringify(raw.schema)}`);
  }
  const testament = String(raw.testament ?? '').toUpperCase();
  if (!TESTAMENTS.includes(testament)) fail(source, '$.testament', `expected "H" or "G", got ${JSON.stringify(raw.testament)}`);

  const given = isPlainObject(raw.entry) ? raw.entry : expectObject(raw.entries, source, '$.entry');
  const entries = {};
  for (const [key, value] of Object.entries(given)) {
    const code = normalizeKey(key);
    if (!code) continue;
    const entry = readEntry(value);
    if (entry) entries[code] = entry;
  }
  if (!Object.keys(entries).length) fail(source, '$.entry', 'this lexicon has no entries in it');

  return {
    testament,
    name: typeof raw.name === 'string' && raw.name ? raw.name : `Strong's ${testament === 'H' ? 'Hebrew' : 'Greek'}`,
    source: typeof raw.source === 'string' ? raw.source : '',
    entries,
  };
}

/** `H7225`, `07225`, `7225` and `g5485` are all the same entry. */
export function normalizeKey(key) {
  const found = /^[HG]?0*(\d+)([a-z])?$/i.exec(String(key ?? '').trim());
  return found ? `${found[1]}${(found[2] ?? '').toLowerCase()}` : '';
}

/** Which file a code belongs in, and what to look up in it. */
export function splitCode(code) {
  const text = String(code ?? '').trim().toUpperCase();
  const letter = /^[HG]/.test(text) ? text[0] : '';
  return { testament: letter, key: normalizeKey(text) };
}

function readEntry(value) {
  if (typeof value === 'string') return value.trim() ? { ...EMPTY, define: value.trim() } : null;
  if (!isPlainObject(value)) return null;
  const text = (...names) => {
    for (const name of names) {
      const found = value[name];
      if (typeof found === 'string' && found.trim()) return found.trim();
    }
    return '';
  };
  const entry = {
    lemma: text('lemma', 'word', 'original', 'w'),
    translit: text('translit', 'xlit', 'transliteration'),
    pronounce: text('pronounce', 'pron', 'pronunciation'),
    part: text('part', 'pos', 'partOfSpeech', 'derivation'),
    define: text('define', 'definition', 'meaning', 'strongs_def', 'desc'),
    kjv: text('kjv', 'kjv_def', 'usage', 'translated'),
  };
  return entry.define || entry.kjv || entry.lemma ? entry : null;
}

const EMPTY = Object.freeze({ lemma: '', translit: '', pronounce: '', part: '', define: '', kjv: '' });

/**
 * The entry for one code, given whichever lexicons are loaded.
 *
 * @param {{ H?: object, G?: object }} held
 * @param {string} code as it appears in the text: `H7225`, `G5485`, or `430`
 * @returns {{ code: string, testament: string, entry: LexEntry|null, why: string }}
 *          `why` names what is missing when there is no entry, because "no
 *          definition" and "that lexicon is not on this device" are different
 *          answers and the reader can act on only one of them.
 */
export function lookup(held, code) {
  const { testament, key } = splitCode(code);
  if (!key) return { code: String(code ?? ''), testament: '', entry: null, why: 'unreadable' };
  // A bare number with no letter cannot be placed: 430 is God in Hebrew and
  // something else entirely in Greek. If only one lexicon is held, that is the
  // one it must have meant.
  const available = TESTAMENTS.filter((t) => held?.[t]);
  const where = testament || (available.length === 1 ? available[0] : '');
  if (!where) return { code, testament: '', entry: null, why: available.length ? 'ambiguous' : 'none' };
  const book = held?.[where];
  if (!book) return { code, testament: where, entry: null, why: 'missing' };
  const entry = book.entries?.[key] ?? null;
  return { code, testament: where, entry, why: entry ? '' : 'absent' };
}
