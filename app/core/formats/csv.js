/**
 * Delimited text: the format people make themselves.
 *
 * A spreadsheet of four columns — book, chapter, verse, text — is how a
 * translation that has never been published exists: somebody typing it, a row
 * at a time, in the only tool they have. It deserves to be importable, and it
 * is the only format here that a reader can fix by hand when the import
 * complains.
 *
 * The delimiter is sniffed rather than asked for, because a comma and a tab are
 * not a question anybody wants to answer about their own file. A header row is
 * recognised if it names its columns and otherwise assumed absent; column order
 * follows the header where there is one, and book/chapter/verse/text where
 * there is not.
 *
 * Quoting is RFC 4180: a field may be wrapped in double quotes, and a doubled
 * quote inside one is a literal quote. Anything else is text.
 */

import { bookMatcher, normalizeName } from './books.js';

const HEADS = Object.freeze({
  book: ['book', 'b', 'bookid', 'booknumber', 'bookname'],
  chapter: ['chapter', 'c', 'chap', 'chapternumber'],
  verse: ['verse', 'v', 'versenumber', 'verseid'],
  text: ['text', 't', 'scripture', 'content', 'versetext'],
  title: ['title', 'heading', 'section'],
});

/** Which delimiter a file uses, by which one divides its lines most evenly. */
export function sniffDelimiter(source) {
  const lines = String(source ?? '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 12);
  if (!lines.length) return ',';
  let best = { delimiter: ',', score: -1 };
  for (const delimiter of ['\t', ',', ';', '|']) {
    const counts = lines.map((line) => splitRow(line, delimiter).length);
    const first = counts[0];
    if (first < 3) continue;
    // Every row the same width, and more columns, is a better guess.
    const even = counts.every((n) => n === first);
    const score = (even ? 100 : 0) + first;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/**
 * @param {string} source
 * @param {{ category: object, delimiter?: string, source?: string }} options
 */
export function fromDelimited(source, { category, delimiter = null, source: name = 'file' }) {
  const sep = delimiter ?? sniffDelimiter(source);
  const books = bookMatcher(category);
  const lines = String(source ?? '').split(/\r?\n/);
  const out = {};
  const report = { books: 0, chapters: 0, verses: 0, titles: 0, notes: 0, delimiter: sep, skipped: 0, unknown: [] };
  const unknown = new Set();

  let columns = null;
  let started = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    const row = splitRow(line, sep);
    if (!started) {
      started = true;
      const head = headerOf(row);
      if (head) { columns = head; continue; }
      columns = { book: 0, chapter: 1, verse: 2, text: 3, title: -1 };
    }

    const bookId = books.idFor(row[columns.book]);
    const chapter = Number.parseInt(row[columns.chapter], 10);
    const verse = Number.parseInt(row[columns.verse], 10);
    const text = String(row[columns.text] ?? '').trim();
    if (!bookId || !Number.isFinite(chapter) || !Number.isFinite(verse) || !text) {
      report.skipped += 1;
      if (!bookId && String(row[columns.book] ?? '').trim()) unknown.add(String(row[columns.book]).trim());
      continue;
    }

    if (!out[bookId]) { out[bookId] = { chapter: {} }; report.books += 1; }
    if (!out[bookId].chapter[chapter]) { out[bookId].chapter[chapter] = { verse: {} }; report.chapters += 1; }
    const place = out[bookId].chapter[chapter].verse;
    if (!place[verse]) report.verses += 1;
    place[verse] = { text };
    const title = columns.title >= 0 ? String(row[columns.title] ?? '').trim() : '';
    if (title) { place[verse].title = title; report.titles += 1; }
  }

  report.unknown = [...unknown].sort().slice(0, 12);
  if (!report.verses) {
    throw new Error(`${name}: no rows could be read as book, chapter, verse and text`);
  }
  return { raw: { book: out, info: {} }, report };
}

/** A header row, as column positions — or null when the first row is data. */
function headerOf(row) {
  const found = { book: -1, chapter: -1, verse: -1, text: -1, title: -1 };
  row.forEach((cell, i) => {
    const key = normalizeName(cell);
    for (const [field, names] of Object.entries(HEADS)) {
      if (found[field] === -1 && names.includes(key)) found[field] = i;
    }
  });
  const enough = found.book >= 0 && found.chapter >= 0 && found.verse >= 0 && found.text >= 0;
  return enough ? found : null;
}

/** One row, honouring quotes. */
export function splitRow(line, delimiter) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (line[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { out.push(field); field = ''; continue; }
    field += ch;
  }
  out.push(field);
  return out.map((cell) => cell.trim());
}
