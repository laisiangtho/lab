/**
 * Writing a translation out, in whichever format it is wanted in.
 *
 * The readers in this folder turn somebody else's file into the shape this app
 * keeps. These do the reverse, and the reason they live beside them rather than
 * inside the two features that want them is that there are two: the source view
 * shows one chapter as USFM or OSIS, and the library exports any selection as
 * the same. Written twice they would be two half-correct USFM emitters that
 * disagreed about footnotes.
 *
 * ## What a writer is given, and what it may assume
 *
 * A `selection`: the translation's own metadata, and the chapters to write, in
 * canon order. Nothing else — no store, no DOM, no network. A writer is
 * therefore as testable as a reader, and the round-trip test (write it, read it
 * back, compare the verses) is the one that actually keeps them honest.
 *
 * ## What is lost, and said to be lost
 *
 * This app keeps what it reads: text, a heading, a cross-reference line, a
 * merge. It does not keep USFM's paragraph structure, its poetry indentation,
 * its footnotes or its red letters, because it does not use them. So a file
 * written here is a faithful record of the verses and an impoverished record of
 * the typesetting, and `lossOf` says so in words the export dialog shows
 * before anybody presses the button. A converter that implies a round trip
 * through this app is lossless would be lying.
 */

import { bookCodes } from './books.js';
import { extractStrongs, strongsRuns } from '../strongs.js';

/**
 * @typedef {{ meta: object, chapters: { book: number, chapter: number, verses: object }[],
 *             bookName?: (book: number) => string,
 *             englishName?: (book: number) => string,
 *             notes?: { book: number, chapter: number, verse: number|null, to: number|null, text: string }[] }} Selection
 */

/**
 * What an export may leave out or change. Every default is the whole file:
 * an option only ever takes something away or rearranges it, so an export
 * made without choosing anything is the fullest one.
 *
 *   strongs     keep Strong's numbers in the text
 *   headings    keep section headings (verse titles)
 *   references  keep cross-reference lines
 *   notes       the reader's own notes, under the verses they are on
 *   compact     no indentation or line breaks between elements (JSON, XML)
 *   names       book names: 'own' (the translation's) or 'english' (the canon's)
 *   noteLabel   the word a note is introduced by, in the reader's language
 *
 * The copyright and the translation's metadata are not an option. Wherever a
 * format has a place for them they are written; a text travels with its terms.
 */
export const EXPORT_DEFAULTS = Object.freeze({
  strongs: true, headings: true, references: true, notes: false, compact: false, names: 'own', noteLabel: 'Note',
});

/** Which options mean anything for a format: the rest are not offered. */
const APPLIES = Object.freeze({
  native: ['strongs', 'headings', 'references', 'compact'],
  usfm: ['strongs', 'headings', 'references'],
  usx: ['strongs', 'headings', 'references', 'compact'],
  osis: ['strongs', 'headings', 'references', 'compact'],
  zefania: ['strongs', 'headings', 'compact'],
  csv: ['strongs', 'headings', 'notes', 'names'],
  markdown: ['strongs', 'headings', 'references', 'notes', 'names'],
});

/** @returns {string[]} the option ids that change what `format` writes */
export function optionsFor(format) {
  const found = APPLIES[format];
  if (!found) throw new Error(`formats: nothing writes "${format}"`);
  return [...found];
}

/** The formats that can be written, in the order they are offered. */
export const WRITERS = Object.freeze([
  { id: 'native', ext: 'json', single: true, label: 'native' },
  { id: 'usfm', ext: 'usfm', single: false, label: 'usfm' },
  { id: 'usx', ext: 'usx', single: false, label: 'usx' },
  { id: 'osis', ext: 'xml', single: true, label: 'osis' },
  { id: 'zefania', ext: 'xml', single: true, label: 'zefania' },
  { id: 'csv', ext: 'csv', single: true, label: 'csv' },
  { id: 'markdown', ext: 'md', single: false, label: 'markdown' },
]);

export const writerById = (id) => WRITERS.find((w) => w.id === id) ?? null;

/**
 * Write a selection.
 *
 * @param {string} format one of `WRITERS`
 * @param {Selection} selection
 * @returns {{ name: string, text: string }[]} one entry per file: a whole Bible
 *          in USFM is 66 files, and in OSIS it is one.
 */
export function write(format, selection, options = {}) {
  const writer = writerById(format);
  if (!writer) throw new Error(`formats: nothing writes "${format}"`);
  for (const key of Object.keys(options)) {
    if (!(key in EXPORT_DEFAULTS)) throw new Error(`formats: unknown export option "${key}"`);
  }
  const opts = { ...EXPORT_DEFAULTS, ...options };
  if (!['own', 'english'].includes(opts.names)) throw new Error(`formats: book names must be "own" or "english", not "${opts.names}"`);
  if (opts.names === 'english' && typeof selection.englishName !== 'function') {
    throw new Error('formats: English book names were asked for and the selection has no englishName');
  }
  const grouped = byBook(shapeChapters(selection.chapters, opts));
  const own = (book) => selection.bookName?.(book)
    ?? selection.meta.books?.[book]?.name
    ?? `Book ${book}`;
  const name = opts.names === 'english' ? (book) => selection.englishName(book) : own;
  const notes = opts.notes ? notesByPlace(selection.notes ?? []) : null;
  const join = opts.compact
    ? (lines) => lines.map((line) => line.trimStart()).join('')
    : (lines) => lines.join('\n');
  const parts = { ...selection, grouped, name, own, notes, join, opts };
  switch (format) {
    case 'native': return [{ name: `${selection.meta.identify}.json`, text: nativeText(parts) }];
    case 'usfm': return grouped.map(([book, chapters]) => ({
      name: `${usfmName(book, selection.meta.identify)}.usfm`,
      text: usfmText(book, chapters, parts),
    }));
    case 'usx': return grouped.map(([book, chapters]) => ({
      name: `${usfmName(book, selection.meta.identify)}.usx`,
      text: usxText(book, chapters, parts),
    }));
    case 'osis': return [{ name: `${selection.meta.identify}.osis.xml`, text: osisText(parts) }];
    case 'zefania': return [{ name: `${selection.meta.identify}.zefania.xml`, text: zefaniaText(parts) }];
    case 'csv': return [{ name: `${selection.meta.identify}.csv`, text: csvText(parts) }];
    case 'markdown': return grouped.map(([book, chapters]) => ({
      name: `${usfmName(book, selection.meta.identify)}.md`,
      text: markdownText(book, chapters, parts),
    }));
    default: throw new Error(`formats: nothing writes "${format}"`);
  }
}

/**
 * The chapters with what was left out taken out, before any writer sees them,
 * so no writer has its own idea of what "without headings" means.
 */
function shapeChapters(chapters, opts) {
  if (opts.strongs && opts.headings && opts.references) return chapters;
  return chapters.map((row) => ({
    ...row,
    verses: Object.fromEntries(Object.entries(row.verses ?? {}).map(([n, verse]) => {
      const out = { ...verse };
      if (!opts.strongs) out.text = extractStrongs(String(verse?.text ?? '')).text;
      if (!opts.headings) delete out.title;
      if (!opts.references) delete out.ref;
      return [n, out];
    })),
  }));
}

/** Notes keyed "book.chapter" for a chapter note, "book.chapter.verse" for a verse or a run. */
function notesByPlace(notes) {
  const map = new Map();
  for (const note of [...notes].sort((a, b) => a.book - b.book || a.chapter - b.chapter
    || (a.verse ?? 0) - (b.verse ?? 0) || String(a.created ?? '').localeCompare(String(b.created ?? '')))) {
    const text = String(note.text ?? '').trim();
    if (!text) continue;
    const key = note.verse == null ? `${note.book}.${note.chapter}` : `${note.book}.${note.chapter}.${note.verse}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...note, text });
  }
  return map;
}

/**
 * The translation's particulars as plain text: what goes beside the files in
 * a zip, so a format with nowhere to put a copyright line (a spreadsheet)
 * still travels with it.
 */
export function aboutText(meta, { format, generated } = {}) {
  const info = meta.info ?? {};
  const lines = [
    `${info.name ?? meta.identify}${info.shortname ? ` (${info.shortname})` : ''}`,
    '',
    ...(info.language?.text ? [`Language: ${info.language.text}`] : []),
    ...(info.year ? [`Year: ${info.year}`] : []),
    ...(info.publisher ? [`Publisher: ${info.publisher}`] : []),
    `Identify: ${meta.identify}, version ${meta.version ?? '?'}`,
    ...(format ? [`Format: ${format}`] : []),
    ...(generated ? [`Written: ${generated}`] : []),
    '',
    'Copyright',
    '',
    info.copyright ? String(info.copyright) : 'The source file states no copyright. Ask the publisher before sharing it.',
    '',
  ];
  return lines.join('\n');
}

/**
 * What a format cannot carry, for the reader about to convert something.
 *
 * Returned as ids, one per sentence, and worded in the interface's locales
 * (`exp.loss.<id>`): this file is pure and the words are the reader's.
 *
 *   layout     paragraphing, poetry layout and footnotes, which this app does not keep
 *   csv        cross-references and the copyright line: a spreadsheet has nowhere for them
 *   markdown   a document to read, not a file to import back
 *   zefania    no element for cross-references, and the layout as above
 *
 * @returns {string[]} nothing when the format loses nothing
 */
export function lossOf(format) {
  switch (format) {
    case 'native': return [];
    case 'csv': return ['csv'];
    case 'markdown': return ['markdown'];
    case 'zefania': return ['zefania'];
    case 'usfm': case 'usx': case 'osis': return ['layout'];
    default: throw new Error(`formats: nothing writes "${format}"`);
  }
}

/** Chapters gathered per book, in canon order. */
function byBook(chapters) {
  const map = new Map();
  for (const row of [...chapters].sort((a, b) => a.book - b.book || a.chapter - b.chapter)) {
    if (!map.has(row.book)) map.set(row.book, []);
    map.get(row.book).push(row);
  }
  return [...map.entries()];
}

/** Verses of one chapter, in order, as [number, verse] pairs. */
function versesOf(chapter) {
  return Object.keys(chapter.verses ?? {})
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((n) => [n, chapter.verses[n]]);
}

const usfmName = (book, identify) => {
  const code = bookCodes(book).usfm || String(book).padStart(3, '0');
  return `${String(book).padStart(2, '0')}-${code}-${identify}`;
};

// --- this app's own JSON ---------------------------------------------------

/**
 * The shape `parseTranslation` reads, so an export is re-importable and a
 * partial export is a smaller translation rather than a broken one.
 */
function nativeText({ meta, grouped, own: name, opts }) {
  const book = {};
  for (const [id, chapters] of grouped) {
    const own = meta.books?.[id];
    book[id] = {
      info: {
        name: own?.name ?? name(id),
        shortname: own?.shortname ?? '',
        abbr: own?.abbr ? [...own.abbr] : [],
      },
      chapter: Object.fromEntries(chapters.map((row) => [row.chapter, {
        verse: Object.fromEntries(versesOf(row).map(([n, verse]) => [n, clean(verse)])),
      }])),
    };
  }
  return `${JSON.stringify({
    identify: meta.identify,
    version: meta.version,
    // The version lives inside `info` in a translation file, and the parsed
    // metadata keeps it at the top; a file written without it there is one this
    // app cannot read back, which an export has no business being.
    info: { ...meta.info, version: meta.version },
    ...(meta.digit?.length ? { digit: [...meta.digit] } : {}),
    ...(meta.testament ? { testament: meta.testament } : {}),
    book,
  }, null, opts.compact ? 0 : 1)}\n`;
}

/** A verse with only the fields it actually has. */
function clean(verse) {
  const out = { text: String(verse?.text ?? '') };
  if (verse?.title) out.title = verse.title;
  if (verse?.ref) out.ref = verse.ref;
  // A merge is a digit string in a translation file, and a number once parsed.
  if (verse?.merge) out.merge = String(verse.merge);
  return out;
}

// --- USFM ------------------------------------------------------------------

function usfmText(book, chapters, { meta, name }) {
  const code = bookCodes(book).usfm;
  const lines = [
    `\\id ${code} ${meta.info.name}`,
    `\\ide UTF-8`,
    ...(meta.info.copyright ? [`\\rem ${oneLine(meta.info.copyright)}`] : []),
    `\\h ${name(book)}`,
    `\\toc1 ${name(book)}`,
    `\\toc2 ${name(book)}`,
    `\\mt1 ${name(book)}`,
  ];
  for (const row of chapters) {
    lines.push(`\\c ${row.chapter}`);
    for (const [n, verse] of versesOf(row)) {
      if (verse.title) lines.push(`\\s1 ${verse.title}`);
      lines.push('\\p');
      lines.push(`\\v ${n}${verse.merge ? `-${verse.merge}` : ''} ${tagged(verse.text, USFM_WORD)}`);
      if (verse.ref) lines.push(`\\r ${verse.ref}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// --- USX -------------------------------------------------------------------

/**
 * USX is USFM's XML sibling: the same markers as elements, verses as
 * milestones rather than containers.
 */
function usxText(book, chapters, { meta, name, join }) {
  const code = bookCodes(book).usfm;
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<usx version="3.0">',
    `  <book code="${code}" style="id">${esc(meta.info.name)}</book>`,
    ...(meta.info.copyright ? [`  <para style="rem">${esc(oneLine(meta.info.copyright))}</para>`] : []),
    `  <para style="h">${esc(name(book))}</para>`,
    `  <para style="mt1">${esc(name(book))}</para>`,
  ];
  for (const row of chapters) {
    out.push(`  <chapter number="${row.chapter}" style="c" sid="${code} ${row.chapter}" />`);
    for (const [n, verse] of versesOf(row)) {
      if (verse.title) out.push(`  <para style="s1">${esc(verse.title)}</para>`);
      const sid = `${code} ${row.chapter}:${n}`;
      out.push('  <para style="p">');
      out.push(`    <verse number="${n}${verse.merge ? `-${verse.merge}` : ''}" style="v" sid="${esc(sid)}" />${tagged(verse.text, USX_WORD)}`);
      out.push(`    <verse eid="${esc(sid)}" />`);
      out.push('  </para>');
      if (verse.ref) out.push(`  <para style="r">${esc(verse.ref)}</para>`);
    }
  }
  out.push('</usx>');
  return `${join(out)}\n`;
}

// --- OSIS ------------------------------------------------------------------

function osisText({ meta, grouped, name, join }) {
  const work = meta.identify;
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">',
    `  <osisText osisIDWork="${esc(work)}" xml:lang="${esc(meta.info.language.code)}">`,
    '    <header>',
    `      <work osisWork="${esc(work)}">`,
    `        <title>${esc(meta.info.name)}</title>`,
    `        <language type="IANA">${esc(meta.info.language.code)}</language>`,
    ...(meta.info.copyright ? [`        <rights>${esc(meta.info.copyright)}</rights>`] : []),
    '      </work>',
    '    </header>',
  ];
  for (const [book, chapters] of grouped) {
    const id = bookCodes(book).osis || String(book);
    out.push(`    <div type="book" osisID="${id}">`);
    out.push(`      <title type="main">${esc(name(book))}</title>`);
    for (const row of chapters) {
      out.push(`      <chapter osisID="${id}.${row.chapter}">`);
      for (const [n, verse] of versesOf(row)) {
        if (verse.title) out.push(`        <title type="section">${esc(verse.title)}</title>`);
        out.push(`        <verse osisID="${id}.${row.chapter}.${n}">${tagged(verse.text, OSIS_WORD)}</verse>`);
        if (verse.ref) out.push(`        <note type="crossReference">${esc(verse.ref)}</note>`);
      }
      out.push('      </chapter>');
    }
    out.push('    </div>');
  }
  out.push('  </osisText>', '</osis>');
  return `${join(out)}\n`;
}

// --- Zefania ---------------------------------------------------------------

function zefaniaText({ meta, grouped, name, join }) {
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<XMLBIBLE biblename="${esc(meta.info.name)}" type="x-bible" revision="${meta.version ?? 1}">`,
    '  <INFORMATION>',
    `    <title>${esc(meta.info.name)}</title>`,
    `    <language>${esc(meta.info.language.name)}</language>`,
    ...(meta.info.publisher ? [`    <publisher>${esc(meta.info.publisher)}</publisher>`] : []),
    ...(meta.info.copyright ? [`    <rights>${esc(meta.info.copyright)}</rights>`] : []),
    '  </INFORMATION>',
  ];
  for (const [book, chapters] of grouped) {
    out.push(`  <BIBLEBOOK bnumber="${book}" bname="${esc(name(book))}">`);
    for (const row of chapters) {
      out.push(`    <CHAPTER cnumber="${row.chapter}">`);
      for (const [n, verse] of versesOf(row)) {
        if (verse.title) out.push(`      <CAPTION vref="${n}">${esc(verse.title)}</CAPTION>`);
        out.push(`      <VERS vnumber="${n}">${tagged(verse.text, ZEFANIA_WORD)}</VERS>`);
      }
      out.push('    </CHAPTER>');
    }
    out.push('  </BIBLEBOOK>');
  }
  out.push('</XMLBIBLE>');
  return `${join(out)}\n`;
}

// --- delimited -------------------------------------------------------------

function csvText({ grouped, name, notes }) {
  const rows = [`book,book_name,chapter,verse,text,title${notes ? ',note' : ''}`];
  for (const [book, chapters] of grouped) {
    for (const row of chapters) {
      versesOf(row).forEach(([n, verse], index) => {
        const cells = [book, name(book), row.chapter, n, verse.text, verse.title ?? ''];
        if (notes) {
          // A chapter note has no verse of its own and goes on the first row
          // of the chapter, ahead of that verse's notes.
          const here = [
            ...(index === 0 ? notes.get(`${book}.${row.chapter}`) ?? [] : []),
            ...(notes.get(`${book}.${row.chapter}.${n}`) ?? []),
          ];
          cells.push(here.map((note) => note.text).join('\n\n'));
        }
        rows.push(cells.map(cell).join(','));
      });
    }
  }
  return `${rows.join('\n')}\n`;
}

/** RFC 4180: quote what needs it, double the quotes inside. */
function cell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// --- Markdown --------------------------------------------------------------

function markdownText(book, chapters, { meta, name, notes, opts }) {
  const info = meta.info;
  const out = [`# ${name(book)}`, '', `> ${info.name} (${info.shortname}) · ${info.language.text}`];
  if (info.copyright) out.push('>', `> ${oneLine(info.copyright)}`);
  out.push('');
  const noteBlock = (note) => {
    // A run says which verses it covers; a note on one verse sits right under it.
    const where = note.verse != null && note.to && note.to !== note.verse ? ` ${note.verse}–${note.to}` : '';
    const lines = note.text.split('\n');
    return [`> **${opts.noteLabel}${where}** ${lines[0]}`, ...lines.slice(1).map((line) => (line ? `> ${line}` : '>')), ''];
  };
  for (const row of chapters) {
    out.push(`## ${name(book)} ${row.chapter}`, '');
    for (const note of notes?.get(`${book}.${row.chapter}`) ?? []) out.push(...noteBlock(note));
    for (const [n, verse] of versesOf(row)) {
      if (verse.title) out.push(`### ${verse.title}`, '');
      out.push(`**${n}${verse.merge ? `–${verse.merge}` : ''}** ${tagged(verse.text, MARKDOWN_WORD)}`, '');
      if (verse.ref) out.push(`> ${verse.ref}`, '');
      for (const note of notes?.get(`${book}.${row.chapter}.${n}`) ?? []) out.push(...noteBlock(note));
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Verse text with its Strong's numbers in a format's own markup, so the file
 * is one that format's other readers understand. The inline notation this app
 * stores (`word{H430}`) is kept only where a format has no markup of its own:
 * this app's JSON, and a spreadsheet. With Strong's numbers left out of the
 * export, `shapeChapters` has already taken them away and this is the text.
 *
 * @param {{ plain: (text: string) => string, word: (text: string, codes: string[]) => string }} style
 */
function tagged(text, style) {
  return strongsRuns(String(text ?? ''), { all: true })
    .map((run) => (run.codes.length ? style.word(run.text, run.codes) : style.plain(run.text)))
    .join('');
}

// USFM 3: `\w word|strong="H430,H1234"\w*`.
const USFM_WORD = { plain: (t) => t, word: (t, codes) => `\\w ${t}|strong="${codes.join(',')}"\\w*` };
const USX_WORD = { plain: (t) => esc(t), word: (t, codes) => `<char style="w" strong="${codes.join(',')}">${esc(t)}</char>` };
const OSIS_WORD = { plain: (t) => esc(t), word: (t, codes) => `<w lemma="${codes.map((c) => `strong:${c}`).join(' ')}">${esc(t)}</w>` };
// Zefania numbers a word without its testament letter; the book says which.
const ZEFANIA_WORD = { plain: (t) => esc(t), word: (t, codes) => `<gr str="${codes.map((c) => c.replace(/^[HG]/, '')).join(' ')}">${esc(t)}</gr>` };
// Markdown has no markup for it; a superscript is what a reader would write.
const MARKDOWN_WORD = { plain: (t) => t, word: (t, codes) => `${t}<sup>${codes.join(' ')}</sup>` };

/** A copyright notice on one line, for the formats that hold one line. */
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

// --- shared ----------------------------------------------------------------

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

/** XML text and attribute escaping; the five predefined entities and no more. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
