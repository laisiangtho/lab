/**
 * Which book is this? — asked of a file that has not been imported yet.
 *
 * Inside the app a book is a number, and a translation's own names are resolved
 * by `core/reference.js` against that translation's metadata. An incoming file
 * has no metadata yet: it says `GEN`, or `Gen`, or `1 Cor`, or `Song of
 * Solomon`, or `66`, and something has to turn that into the canon's id before
 * anything else can be checked.
 *
 * Three sources, in order of how much they can be trusted:
 *
 *   1. The canon itself — `category.json` carries an English name, a short name
 *      and a list of abbreviations for all 66 books, which is where most of the
 *      answers already are.
 *   2. The two standard code sets, which the canon does not carry: Paratext's
 *      three-letter USFM ids (`GEN`, `1CO`, `SNG`) and OSIS ids (`Gen`, `1Cor`,
 *      `Song`). These are what USFM, USFX and OSIS files actually contain.
 *   3. A plain number, for files that identify books by position.
 *
 * Nothing here guesses. A name that matches nothing returns null and the import
 * says which name it could not place — a file where "Psalm" silently became
 * Proverbs would be worse than one that refused to load.
 */

/** Paratext / USFM book ids, in canon order. */
const USFM = Object.freeze([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI',
  '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP',
  'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
  '3JN', 'JUD', 'REV',
]);

/** OSIS book ids, in canon order. */
const OSIS = Object.freeze([
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs',
  '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer',
  'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph',
  'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph', 'Phil', 'Col',
  '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas', '1Pet', '2Pet', '1John', '2John',
  '3John', 'Jude', 'Rev',
]);

/**
 * Names the standards do not cover and files use anyway. Kept short: anything
 * the canon's own `abbr` list carries does not belong here.
 */
const ALSO = Object.freeze({
  songofsolomon: 22,
  songofsongs: 22,
  canticles: 22,
  qoheleth: 21,
  psalms: 19,
  psalm: 19,
  revelationofjohn: 66,
  apocalypse: 66,
  actsoftheapostles: 44,
  firstsamuel: 9,
  secondsamuel: 10,
});

/** How a name is compared: letters and digits only, lower case. */
export function normalizeName(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Build a matcher for one canon.
 *
 * @param {{ books: () => {id: number, name?: string, shortname?: string, abbr?: string[]}[] }
 *         | {id: number, info?: object, name?: string}[]} category the parsed
 *        canon, or its book list
 * @returns {{ idFor: (name: unknown) => number|null, usfmFor: (id: number) => string }}
 */
export function bookMatcher(category) {
  const table = new Map();
  const put = (name, id) => {
    const key = normalizeName(name);
    // First writer wins *within* a layer; the layers below decide the rest.
    if (key && !table.has(key)) table.set(key, id);
  };

  const books = bookList(category);

  // Three layers, most authoritative first — and the order matters more than
  // it looks. `ISA` is the USFM code for Isaiah and nothing else, but the
  // canon lists "I Sa" among 1 Samuel's abbreviations, which normalises to the
  // same `isa`. With one flat pass and the canon added first, 1 Samuel claimed
  // it, so every USFM and USFX import silently filed Isaiah's sixty-six
  // chapters under 1 Samuel and then reported Isaiah missing.
  //
  // A standard code is an identifier: it means one book, it was written by a
  // machine, and it can never be a near-miss for another. A published
  // abbreviation is a convenience someone typed. So codes first, then the
  // canon's own primary names, then the variants — and a variant that collides
  // with either of the first two is simply not heard.
  USFM.forEach((code, i) => put(code, i + 1));
  OSIS.forEach((code, i) => put(code, i + 1));

  for (const book of books) {
    const info = book.info ?? book;
    put(info.name, book.id);
    put(info.shortname, book.id);
  }

  for (const book of books) {
    const info = book.info ?? book;
    for (const abbr of info.abbr ?? []) put(abbr, book.id);
  }
  for (const [name, id] of Object.entries(ALSO)) put(name, id);

  return {
    idFor(name) {
      const raw = String(name ?? '').trim();
      if (!raw) return null;
      // A bare number is a position in the canon, which is how several formats
      // and every spreadsheet identify a book.
      if (/^\d+$/.test(raw)) {
        const n = Number(raw);
        return n >= 1 && n <= 66 ? n : null;
      }
      // An OSIS reference identifies the book before its first stop: "Gen.1.1".
      const head = raw.includes('.') ? raw.slice(0, raw.indexOf('.')) : raw;
      return table.get(normalizeName(head)) ?? table.get(normalizeName(raw)) ?? null;
    },
    usfmFor: (id) => USFM[id - 1] ?? '',
  };
}

/** The books of a parsed canon, of a raw `category.json`, or a bare list. */
function bookList(category) {
  if (Array.isArray(category)) return category;
  if (Array.isArray(category?.books)) return category.books;
  if (Array.isArray(category?.book)) return category.book;
  return [];
}

/**
 * The two standard codes for one canon book, for anything writing a file.
 * @returns {{ usfm: string, osis: string }}
 */
export function bookCodes(id) {
  return { usfm: USFM[id - 1] ?? '', osis: OSIS[id - 1] ?? '' };
}

export { USFM, OSIS };
