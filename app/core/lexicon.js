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
 *         "gloss": "beginning",
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
 *             gloss: string, define: string, kjv: string }} LexEntry
 * `gloss` is a word or two for an interlinear line; without one, the start
 * of the definition stands in (`glossOf`).
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
    gloss: text('gloss', 'short'),
    define: text('define', 'definition', 'meaning', 'strongs_def', 'desc'),
    kjv: text('kjv', 'kjv_def', 'usage', 'translated'),
  };
  return entry.define || entry.kjv || entry.lemma ? entry : null;
}

const EMPTY = Object.freeze({ lemma: '', translit: '', pronounce: '', part: '', gloss: '', define: '', kjv: '' });

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
/**
 * A few words for an interlinear line: the first line of the definition, up
 * to its first semicolon, no longer than a short phrase. STEPBible's entries
 * open with exactly this ("to create"); a Strong's dictionary opens with its
 * first rendering.
 */
export function glossOf(entry, { max = 28 } = {}) {
  const first = (String(entry?.gloss ?? '').trim()
    || String(entry?.define ?? '').split('\n')[0].split(/[;(]/)[0]).replace(/[\s,.:]+$/, '').trim();
  if (!first) return '';
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

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
  // A sense the lexicon does not split (H1254a against a plain Strong's) is
  // read as the number it is a sense of.
  let entry = book.entries?.[key] ?? book.entries?.[key.replace(/[a-z]$/, '')] ?? null;
  // The other way round: a plain Strong's number against a lexicon that only
  // has its senses (STEPBible's H1254a and H1254b, and no H1254). The first
  // sense is the answer, and the senses are named so the reader knows it is
  // one of several.
  let senses = [];
  if (!entry && /\d$/.test(key)) {
    senses = Object.keys(book.entries ?? {}).filter((k) => k.length === key.length + 1 && k.startsWith(key) && /[a-z]$/.test(k)).sort();
    entry = senses.length ? book.entries[senses[0]] : null;
  }
  return { code, testament: where, entry, why: entry ? '' : 'absent', senses };
}

/**
 * STEPBible's brief lexicons of extended Strong's numbers — TBESH (Hebrew)
 * and TBESG (Greek), CC BY 4.0 — as they are published: tab-separated text,
 * a header and then one line a sense:
 *
 *   eStrong  dStrong            uStrong  word     translit  part    gloss       meaning
 *   H1254a   H1254A =           H1254A   בָּרָא    ba.ra     H:V     to create   1) to create, shape …<br>…
 *   H0430    H0430G = a Name of H3068G   אֱלֹהִים  e.lo.him  H:N-M   God         …
 *
 * The first column is the number as OpenScriptures and STEPBible tag their
 * texts, sense letter included (`H1254a`), so it is the key. A number with
 * several lines — a word and the names built on it — keeps its plain sense:
 * the line whose second column says nothing after "=", or else the first.
 * The meaning is HTML; it is kept as text, its line breaks as line breaks.
 *
 * @returns {{ testament: string, name: string, source: string, entries: Record<string, LexEntry> }}
 */
export function readStepLexicon(text, { source }) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const title = (lines.find((line) => /^TBES[HG]\b/.test(line.trim())) ?? '').trim();
  const entries = {};
  const plain = {};
  const letters = { H: 0, G: 0 };
  for (const line of lines) {
    if (!/^[HG]\d{1,5}[a-z]?\t/i.test(line)) continue;
    const cells = line.split('\t');
    if (cells.length < 8) continue;
    const key = normalizeKey(cells[0]);
    if (!key) continue;
    letters[cells[0][0].toUpperCase()] += 1;
    const isPlain = /=\s*$/.test(cells[1].trim());
    if (entries[key] && (plain[key] || !isPlain)) continue;
    entries[key] = {
      ...EMPTY,
      lemma: cells[3].trim(),
      translit: cells[4].trim(),
      part: cells[5].trim(),
      gloss: cells[6].trim(),
      define: [cells[6].trim(), htmlText(cells[7])].filter(Boolean).join('\n'),
    };
    plain[key] = isPlain;
  }
  const testament = letters.H >= letters.G ? 'H' : 'G';
  if (!Object.keys(entries).length) fail(source, '$', 'no lexicon lines in this file (expected STEPBible TBESH or TBESG)');
  return {
    testament,
    name: title.replace(/\s+-\s+STEPBible\.org.*$/, '') || `STEPBible ${testament === 'H' ? 'Hebrew' : 'Greek'}`,
    source: title.includes('CC BY') ? 'STEPBible.org, CC BY 4.0' : 'STEPBible.org',
    entries,
  };
}

/** Whether a text is one of STEPBible's lexicons, by its own first line. */
export const isStepLexicon = (text) => /^\uFEFF?TBES[HG]\b/.test(String(text ?? '').trimStart());

/**
 * A lexicon file of either kind a reader may bring: this app's JSON, or a
 * STEPBible brief lexicon.
 */
export function readLexiconFile(text, { source }) {
  if (isStepLexicon(text)) return readStepLexicon(text, { source });
  let raw;
  try { raw = JSON.parse(text); } catch {
    fail(source, '$', 'not a lexicon this app reads: expected its JSON lexicon or STEPBible TBESH/TBESG');
  }
  return parseLexicon(raw, { source });
}

/** HTML as plain text: tags gone, line breaks kept, entities read. */
function htmlText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}
