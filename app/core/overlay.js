/**
 * Overlays: data that belongs to a translation without being in its file.
 *
 * The catalog repository keeps one folder per kind and one file per
 * translation, named by the translation's identify:
 *
 *   strongs/{identify}.json   a Strong's number for each word of each verse
 *   refs/{identify}.json      a cross-reference line for each verse
 *
 * `json/{identify}.json` stays the master. An overlay holds none of its text,
 * follows its layout (book → chapter → verse), and has no meaning without it.
 *
 * ## Strong's overlay
 *
 * A verse is `{ w, of }`. `w` holds one entry per word, a word being a run of
 * characters between whitespace (`wordsOf`): a Strong's number, an edition
 * number for a word with nothing behind it in the original (H9999, G9999), or
 * null for a word left untagged. `of` is `verseHash` of the verse text the
 * entries were made for. A verse whose text has changed since is refused,
 * never applied to words it was not made for.
 *
 * `applyStrongs` writes the numbers into the text in the inline notation
 * (`word{H430}`) that core/strongs.js reads, so everything downstream of the
 * library is unchanged.
 *
 * ## Reference overlay
 *
 * A verse is `{ ref }`, the same string a translation file may carry itself.
 */

import { normalizeCode } from './strongs.js';

const WORD = /\S+/gu;
// A number is written after the word and before the punctuation that closes
// it: "hi{H9999}." and "cin’{H7462}", so the word shown is the word alone.
const CLOSING = /[^\p{L}\p{N}\p{M}'’]+$/u;

/** FNV-1a, 32 bits, over the UTF-8 bytes of the text; eight hex digits. */
export function verseHash(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(text))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The words of a verse, as the overlay counts them. */
export function wordsOf(text) {
  return String(text).match(WORD) ?? [];
}

/**
 * @param {string} text the master's verse text
 * @param {{ w: (string|null)[], of: string }} entry
 * @param {string} [where] named in the error
 * @returns {string} the text with its numbers inline
 */
export function applyStrongs(text, entry, where = 'verse') {
  const source = String(text);
  if (!entry || !Array.isArray(entry.w) || typeof entry.of !== 'string') throw new Error(`overlay: ${where}: expected { w, of }`);
  const hash = verseHash(source);
  if (entry.of !== hash) throw new Error(`overlay: ${where}: made for text ${entry.of}, the verse is now ${hash}`);
  const count = wordsOf(source).length;
  if (entry.w.length !== count) throw new Error(`overlay: ${where}: ${entry.w.length} entries for ${count} words`);
  let index = 0;
  return source.replace(WORD, (word) => {
    const code = entry.w[index];
    index += 1;
    if (code === null) return word;
    const tag = `{${normalizeCode(code)}}`;
    // A token that is all punctuation has no word for a number to sit on.
    if (!/[\p{L}\p{N}]/u.test(word)) throw new Error(`overlay: ${where}: a number on "${word}", which is not a word`);
    const closing = CLOSING.exec(word);
    return closing ? `${word.slice(0, closing.index)}${tag}${closing[0]}` : `${word}${tag}`;
  });
}

/**
 * The overlay's header, checked: `{ identify, kind, version, review }`.
 * @param {unknown} raw
 * @param {{ identify: string, kind: 'strongs'|'refs' }} expected
 */
export function overlayInfo(raw, { identify, kind }) {
  const source = `${kind}/${identify}.json`;
  const info = raw?.info;
  if (!info || typeof info !== 'object') throw new Error(`${source}: no info`);
  if (info.identify !== identify) throw new Error(`${source}: expected identify ${identify}, file declares ${info.identify}`);
  if (info.kind !== kind) throw new Error(`${source}: expected kind ${kind}, file declares ${info.kind}`);
  if (!Number.isInteger(info.version) || info.version < 1) throw new Error(`${source}: version must be a positive integer`);
  if (!raw.book || typeof raw.book !== 'object') throw new Error(`${source}: no book`);
  return { identify, kind, version: info.version, review: info.review === true };
}
