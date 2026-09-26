/**
 * Reading a passage out of what somebody typed.
 *
 * "ps 2", "Psa 3:5", "1 jn 2:1-4", "ကမ္ဘာ ၃", "gen" — the shorthand a reader
 * who knows their way around reaches for, and the thing that makes a command
 * line worth having. What it understands:
 *
 *   <book>                  the book, at its first chapter
 *   <book> <chapter>
 *   <book> <chapter>:<verse>
 *   <book> <chapter>:<verse>-<verse>
 *
 * A book is matched in this order, and the first layer that answers wins:
 * exactly (a name, a short name or a published abbreviation, in the
 * translation being read or in the canon), then by prefix. A prefix that fits
 * several books is not a guess — every candidate is returned, so whoever asked
 * can choose.
 *
 * Nothing here touches the DOM or storage, and nothing is clamped to what a
 * particular translation holds: how many verses a chapter has is the
 * translation's business, and a reference past the end of one edition is still
 * a reference.
 */

import { normalizeKey } from './reference.js';

/**
 * @param {{ category: any, resolver?: { resolve(token: string): number|null } | null,
 *           bookName?: (id: number) => string, digits?: string[] }} deps
 *   `bookName` is how the translation being read names a book; `digits` is its
 *   own numerals, so "ကမ္ဘာ ၃" reads the same as "Genesis 3".
 */
export function createLookup({ category, resolver = null, bookName = null, digits = null }) {
  /** normalised token → book id, for the prefix pass. */
  const names = [];
  for (const book of category.books) {
    const forms = [book.name, book.shortname, ...book.abbr];
    if (bookName) forms.push(bookName(book.id));
    for (const form of forms) {
      if (!form) continue;
      const key = normalizeKey(String(form));
      if (key) names.push({ key, id: book.id });
    }
  }

  return {
    /**
     * Every book whose name starts with this token, nearest first.
     * @returns {number[]} book ids, without repeats
     */
    starting(token) {
      const key = normalizeKey(token);
      if (!key) return [];
      const hits = new Map();
      for (const { key: name, id } of names) {
        if (!name.startsWith(key)) continue;
        const score = name.length - key.length;
        if (!hits.has(id) || hits.get(id) > score) hits.set(id, score);
      }
      return [...hits.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([id]) => id);
    },

    /** The book this token names exactly, or null. */
    exact(token) {
      const direct = resolver?.resolve(token) ?? null;
      if (direct !== null) return direct;
      const key = normalizeKey(token);
      const hit = names.find((n) => n.key === key);
      return hit ? hit.id : null;
    },

    chapters: (id) => category.book(id).chapters,
    digits,
  };
}

/**
 * @param {string} text what was typed
 * @param {ReturnType<typeof createLookup>} lookup
 * @returns {{ books: number[], chapter: number|null, verse: number|null, to: number|null,
 *             exact: boolean } | null} null when it cannot be a reference at all
 */
export function parsePassageQuery(text, lookup) {
  const typed = toAscii(String(text ?? '').trim(), lookup.digits);
  if (!typed) return null;

  // The locator is the numbers at the end; everything before it names the book.
  const match = /^(.*?)\s*(\d+)?(?:\s*[:.]\s*(\d+))?(?:\s*[-–—]\s*(\d+))?\s*$/.exec(typed);
  if (!match) return null;
  const [, rawBook, rawChapter, rawVerse, rawTo] = match;
  const token = rawBook.trim();

  // A bare number is a chapter of the book already open, which the caller
  // knows and this does not; without a book token there is nothing to resolve.
  if (!token) return null;

  // A token that is somebody's published abbreviation still leaves the other
  // books that start the same way worth offering: "jo" is John's abbreviation
  // in the canon, and also the start of Job, Joel, Jonah and Joshua.
  const exact = lookup.exact(token);
  const starting = lookup.starting(token);
  const books = exact === null ? starting : [exact, ...starting.filter((id) => id !== exact)];
  if (!books.length) return null;

  const chapter = rawChapter ? Number(rawChapter) : null;
  const verse = rawVerse ? Number(rawVerse) : null;
  const to = rawTo ? Number(rawTo) : null;
  // "Psalm 3-5" is chapters 3 to 5 in speech, but as a target it is one
  // chapter; the range only means verses when a verse was given.
  return {
    books,
    chapter: chapter === null ? null : Math.max(1, chapter),
    verse,
    to: verse === null ? null : to,
    exact: exact !== null,
  };
}

/** A passage, clamped to what the canon says the book holds. */
export function passageOf(query, book, lookup) {
  const chapters = lookup.chapters(book);
  const chapter = Math.min(Math.max(query.chapter ?? 1, 1), chapters);
  return { book, chapter, verse: query.verse, to: query.to && query.to > (query.verse ?? 0) ? query.to : null };
}

/** Native numerals in, ASCII digits out, so "၃:၅" parses like "3:5". */
function toAscii(text, digits) {
  if (!digits || digits.length !== 10) return text;
  let out = '';
  for (const ch of text) {
    const index = digits.indexOf(ch);
    out += index === -1 ? ch : String(index);
  }
  return out;
}
