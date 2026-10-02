/**
 * json/{identify}.json — one translation.
 *
 * Structural problems (wrong types, unknown keys, bad merge values) raise a
 * DataError. Content differences from category.json (versification) are not
 * errors; they are returned in `diagnostics` so the UI can surface them.
 *
 * So are the faults a file can be read past (FAULTS): what can be read is
 * kept, what cannot is left out, and each is recorded so a reader is told
 * what to expect before and after installing.
 *
 *   outside-canon     a book whose number is not in category.json: left out
 *   names-unaligned   the file has books outside the canon, or books with no
 *                     `info`: its names are then in an order of its own and
 *                     belong to other books, so the canon's names are used
 *   copied-book       a book whose first chapter is word for word an earlier
 *                     book's (a converter's filler for a book the edition
 *                     does not have): left out
 *   empty-verse       a verse with no text: left out
 *   merge-overlap     a verse joined to others that are also given on their
 *                     own: the join is dropped, the verses kept
 *
 * Output is split for storage: one `meta` record plus one record per chapter.
 * Empty-string optional fields ("title": "", "merge": "") are published by some
 * translations and are normalised to absent.
 */

import {
  expectArray, expectObject, expectString, fail, isPlainObject, normalizeVersion, numericKey, optionalString,
} from './errors.js';
import { chapterAgainstCanon } from './examine.js';
import { toTag } from './langcode.js';
import { hasStrongs, tallyStrongs } from './strongs.js';

const VERSE_KEYS = new Set(['text', 'title', 'ref', 'merge']);

/** The kinds of diagnostic that are faults in the file, not departures of the edition. */
export const FAULTS = Object.freeze(['outside-canon', 'names-unaligned', 'copied-book', 'empty-verse', 'merge-overlap']);

/** How many of each fault a list of diagnostics holds: { kind: n }, only what is there. */
export function faultsOf(diagnostics) {
  const out = {};
  for (const d of diagnostics ?? []) if (FAULTS.includes(d.type)) out[d.type] = (out[d.type] ?? 0) + 1;
  return out;
}

/**
 * A book's opening, as one string to compare: the texts of its first
 * chapter. Null where there are too few verses for a match to mean anything.
 */
function opening(bookRaw) {
  const first = isPlainObject(bookRaw?.chapter) ? Object.values(bookRaw.chapter)[0] : null;
  const verses = isPlainObject(first?.verse) ? Object.values(first.verse) : [];
  if (verses.length < 3) return null;
  return verses.map((v) => (typeof v?.text === 'string' ? v.text : '')).join('\n');
}

/**
 * @typedef {{ text: string, title?: string, ref?: string, merge?: number }} Verse
 * @typedef {{ book: number, chapter: number, verses: Record<string, Verse> }} ChapterRecord
 * @typedef {{ type: 'versification'|'extra-chapter'|'missing-book'|'outside-canon'|'names-unaligned'
 *                   |'copied-book'|'empty-verse'|'merge-overlap', book: number,
 *             chapter?: number, verse?: number, expected?: number, actual?: number }} Diagnostic
 */

/**
 * @param {unknown} raw
 * @param {{ identify: string, category: ReturnType<import('./category.js').parseCategory> }} options
 */
export function parseTranslation(raw, { identify, category }) {
  const S = `${identify}.json`;
  expectObject(raw, S, '$');

  const info = expectObject(raw.info, S, '$.info');
  const fileIdentify = expectString(info.identify, S, '$.info.identify');
  if (fileIdentify !== identify) fail(S, '$.info.identify', `expected ${identify}, file declares ${fileIdentify}`);
  const version = normalizeVersion(info.version, S, '$.info.version');
  const language = expectObject(info.language, S, '$.info.language');
  const textdirection = expectString(language.textdirection, S, '$.info.language.textdirection');
  if (textdirection !== 'ltr' && textdirection !== 'rtl') {
    fail(S, '$.info.language.textdirection', `expected ltr or rtl, got ${textdirection}`);
  }

  const digit = raw.digit === undefined ? [] : expectArray(raw.digit, S, '$.digit')
    .map((d, i) => expectString(d, S, `$.digit[${i}]`));
  if (digit.length !== 0 && digit.length !== 10) fail(S, '$.digit', `expected 0 or 10 digits, got ${digit.length}`);

  const labels = raw.language === undefined ? {} : expectObject(raw.language, S, '$.language');
  const testament = raw.testament === undefined ? {} : expectObject(raw.testament, S, '$.testament');
  const story = parseStory(raw.story, S, category);

  const booksRaw = expectObject(raw.book, S, '$.book');
  const books = {};
  const chapters = [];
  const diagnostics = [];
  // Names are taken from the file only when every book in it is one of the
  // canon's and says what it is called. Otherwise the list of names is the
  // edition's own (with books the canon lacks in among them) written down
  // the slots in order, and a name sits on a book it does not belong to.
  const aligned = Object.entries(booksRaw).every(([key, book]) => /^\d+$/.test(key) && category.hasBook(Number(key)) && book?.info !== undefined);
  if (!aligned) diagnostics.push({ type: 'names-unaligned', book: 0 });
  const openings = new Map();
  // `strongs`: how many words carry a Strong's number, and the edition's own
  // numbers past the end of the lexicon, by number (core/strongs.js).
  const stats = { books: 0, chapters: 0, verses: 0, merges: 0, titles: 0, refs: 0, strongs: { words: 0, edition: {} } };

  for (const [bookKey, bookRaw] of Object.entries(booksRaw)) {
    const bp = `$.book.${bookKey}`;
    const bookId = numericKey(bookKey, S, bp);
    if (!category.hasBook(bookId)) { diagnostics.push({ type: 'outside-canon', book: bookId }); continue; }
    const canon = category.book(bookId);
    expectObject(bookRaw, S, bp);

    const start = opening(bookRaw);
    if (start !== null) {
      if (openings.has(start)) { diagnostics.push({ type: 'copied-book', book: bookId, expected: openings.get(start) }); continue; }
      openings.set(start, bookId);
    }

    const bi = aligned ? expectObject(bookRaw.info, S, `${bp}.info`) : {};
    books[bookId] = Object.freeze({
      name: optionalString(bi.name, S, `${bp}.info.name`) ?? canon.name,
      shortname: optionalString(bi.shortname, S, `${bp}.info.shortname`) ?? canon.shortname,
      abbr: Object.freeze((bi.abbr === undefined ? [] : expectArray(bi.abbr, S, `${bp}.info.abbr`))
        .map((a, i) => expectString(a, S, `${bp}.info.abbr[${i}]`)).filter(Boolean)),
      desc: optionalString(bi.desc, S, `${bp}.info.desc`) ?? '',
    });
    stats.books += 1;

    const chaptersRaw = expectObject(bookRaw.chapter, S, `${bp}.chapter`);
    for (const [chKey, chRaw] of Object.entries(chaptersRaw)) {
      const cp = `${bp}.chapter.${chKey}`;
      const chapter = numericKey(chKey, S, cp);
      expectObject(chRaw, S, cp);
      for (const k of Object.keys(chRaw)) if (k !== 'verse') fail(S, `${cp}.${k}`, 'unknown chapter key');

      const verses = parseVerses(expectObject(chRaw.verse, S, `${cp}.verse`), S, `${cp}.verse`, stats,
        (type, verse) => diagnostics.push({ type, book: bookId, chapter, verse }));
      chapters.push(Object.freeze({ book: bookId, chapter, verses }));
      stats.chapters += 1;

      // The same rule the report applies later, from the same module: an
      // install that disagrees with an examination is two answers to one
      // question, and the reader has no way to tell which is the true one.
      const finding = chapterAgainstCanon(category, bookId, chapter, verses);
      if (finding) diagnostics.push(finding);
    }
  }

  for (const b of category.books) {
    if (!books[b.id]) diagnostics.push({ type: 'missing-book', book: b.id });
  }

  const meta = Object.freeze({
    identify,
    version,
    info: Object.freeze({
      name: expectString(info.name, S, '$.info.name'),
      shortname: optionalString(info.shortname, S, '$.info.shortname') ?? identify,
      year: String(info.year ?? ''),
      description: optionalString(info.description, S, '$.info.description') ?? '',
      publisher: optionalString(info.publisher, S, '$.info.publisher') ?? '',
      copyright: optionalString(info.copyright, S, '$.info.copyright') ?? '',
      language: Object.freeze({
        text: expectString(language.text, S, '$.info.language.text'),
        name: expectString(language.name, S, '$.info.language.name'),
        // What goes in a `lang` attribute, and what a speech engine is asked
        // for. Files name the language by its ISO 639-3 code ("mya", "ctd");
        // CSS and the browser's own line breaking know the two-letter code, so
        // that one wins where the language has one — `:lang(my)` does not match
        // `lang="mya"`, and a Burmese voice calls itself `my-MM`.
        code: languageCode(language),
        // The pair as the file gave it, kept rather than thrown away: a
        // consumer that needs to know which of the two it is holding cannot
        // work it out from the answer alone.
        iso: Object.freeze({
          '639-1': isoPart(language, '639-1'),
          '639-3': isoPart(language, '639-3'),
        }),
        textdirection,
      }),
    }),
    digit: Object.freeze(digit),
    labels,
    testament,
    story,
    books: Object.freeze(books),
  });

  return { meta, chapters, diagnostics, stats };
}

/** One half of the file's `iso` pair, or '' where it gave none. */
function isoPart(language, key) {
  const iso = isPlainObject(language.iso) ? language.iso : {};
  return typeof iso[key] === 'string' ? iso[key].trim() : '';
}

/**
 * The best tag the file supports: its own 639-1 if it gives one, otherwise the
 * two-letter code its 639-3 stands for, otherwise the 639-3 code itself.
 *
 * The middle step matters more than it looks. Most translation files carry a
 * 639-3 code and an empty 639-1 — the field exists and nobody filled it in —
 * and without the lookup every one of them is handed to the browser as a code
 * it has never heard of.
 */
function languageCode(language) {
  const short = isoPart(language, '639-1');
  if (short) return short;
  const long = isoPart(language, '639-3') || String(language.name ?? '').trim();
  return toTag(long);
}

function parseVerses(raw, S, path, stats, fault) {
  const out = {};
  for (const [vKey, vRaw] of Object.entries(raw)) {
    const vp = `${path}.${vKey}`;
    const n = numericKey(vKey, S, vp);
    expectObject(vRaw, S, vp);
    for (const k of Object.keys(vRaw)) if (!VERSE_KEYS.has(k)) fail(S, `${vp}.${k}`, 'unknown verse key');

    // A verse some editions leave out, written as a number with nothing
    // under it (a cross-reference at most): there is nothing to read.
    if (vRaw.text === undefined) { fault('empty-verse', n); continue; }
    const verse = { text: expectString(vRaw.text, S, `${vp}.text`) };
    const title = optionalString(vRaw.title, S, `${vp}.title`);
    const ref = optionalString(vRaw.ref, S, `${vp}.ref`);
    const merge = optionalString(vRaw.merge, S, `${vp}.merge`);
    if (title !== undefined) { verse.title = title; stats.titles += 1; }
    if (ref !== undefined) { verse.ref = ref; stats.refs += 1; }
    if (merge !== undefined) {
      if (!/^\d+$/.test(merge) || Number(merge) <= n) fail(S, `${vp}.merge`, `expected a verse number greater than ${n}, got ${JSON.stringify(merge)}`);
      verse.merge = Number(merge);
      stats.merges += 1;
    }
    if (hasStrongs(verse.text)) tallyStrongs(verse.text, stats.strongs);
    out[n] = verse;
    stats.verses += 1;
  }
  // Covered verses are absent: "merge": "18" on verse 17 means no verse 18
  // key. Where they are there all the same, the verses are what was written
  // and the join is what was claimed: the verses are kept.
  for (const [key, verse] of Object.entries(out)) {
    if (verse.merge === undefined) continue;
    for (let m = Number(key) + 1; m <= verse.merge; m += 1) {
      if (!out[m]) continue;
      delete verse.merge;
      stats.merges -= 1;
      fault('merge-overlap', Number(key));
      break;
    }
  }
  for (const verse of Object.values(out)) Object.freeze(verse);
  return Object.freeze(out);
}

/** story[book][chapter][verse] = { text, ref } — pericope headings. */
function parseStory(raw, S, category) {
  if (raw === undefined) return {};
  expectObject(raw, S, '$.story');
  const out = {};
  for (const [b, chapters] of Object.entries(raw)) {
    const bookId = numericKey(b, S, `$.story.${b}`);
    // Headings for a book outside the canon go the way of the book.
    if (!category.hasBook(bookId)) continue;
    expectObject(chapters, S, `$.story.${b}`);
    out[bookId] = {};
    for (const [c, verses] of Object.entries(chapters)) {
      numericKey(c, S, `$.story.${b}.${c}`);
      expectObject(verses, S, `$.story.${b}.${c}`);
      out[bookId][c] = {};
      for (const [v, entry] of Object.entries(verses)) {
        const p = `$.story.${b}.${c}.${v}`;
        numericKey(v, S, p);
        if (!isPlainObject(entry)) fail(S, p, 'expected { text, ref }');
        out[bookId][c][v] = Object.freeze({
          text: expectString(entry.text, S, `${p}.text`),
          ref: optionalString(entry.ref, S, `${p}.ref`) ?? '',
        });
      }
    }
  }
  return out;
}

/** Localised verse/chapter number using the translation's digit table. */
export function localizeNumber(n, digit) {
  if (!digit || digit.length !== 10) return String(n);
  return String(n).replace(/\d/g, (d) => digit[Number(d)]);
}
