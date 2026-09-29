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
 * the typesetting, and `describeLoss` says so in words the export dialog shows
 * before anybody presses the button. A converter that implies a round trip
 * through this app is lossless would be lying.
 */

import { bookCodes } from './books.js';

/**
 * @typedef {{ meta: object, chapters: { book: number, chapter: number, verses: object }[],
 *             bookName?: (book: number) => string }} Selection
 */

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
export function write(format, selection) {
  const writer = writerById(format);
  if (!writer) throw new Error(`formats: nothing writes "${format}"`);
  const grouped = byBook(selection.chapters);
  const name = (book) => selection.bookName?.(book)
    ?? selection.meta.books?.[book]?.name
    ?? `Book ${book}`;
  const parts = { ...selection, grouped, name };
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
 * What this app cannot carry, for the reader about to convert something.
 * @returns {string[]} plain sentences, or nothing when the format loses nothing
 */
export function describeLoss(format) {
  const shared = 'paragraphing, poetry layout, footnotes and any typesetting the original carried';
  switch (format) {
    case 'native': return [];
    case 'csv': return ['Headings and cross-references are dropped; a spreadsheet has nowhere to put them.'];
    case 'markdown': return ['This is something to read rather than a file to import back: verse numbers become labels.'];
    default: return [`Verses, headings and cross-references are written; ${shared} is not, because this app does not keep it.`];
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
function nativeText({ meta, grouped, name }) {
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
  }, null, 1)}\n`;
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
      lines.push(`\\v ${n}${verse.merge ? `-${verse.merge}` : ''} ${verse.text}`);
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
function usxText(book, chapters, { meta, name }) {
  const code = bookCodes(book).usfm;
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<usx version="3.0">',
    `  <book code="${code}" style="id">${esc(meta.info.name)}</book>`,
    `  <para style="h">${esc(name(book))}</para>`,
    `  <para style="mt1">${esc(name(book))}</para>`,
  ];
  for (const row of chapters) {
    out.push(`  <chapter number="${row.chapter}" style="c" sid="${code} ${row.chapter}" />`);
    for (const [n, verse] of versesOf(row)) {
      if (verse.title) out.push(`  <para style="s1">${esc(verse.title)}</para>`);
      const sid = `${code} ${row.chapter}:${n}`;
      out.push('  <para style="p">');
      out.push(`    <verse number="${n}${verse.merge ? `-${verse.merge}` : ''}" style="v" sid="${esc(sid)}" />${esc(verse.text)}`);
      out.push(`    <verse eid="${esc(sid)}" />`);
      out.push('  </para>');
      if (verse.ref) out.push(`  <para style="r">${esc(verse.ref)}</para>`);
    }
  }
  out.push('</usx>');
  return `${out.join('\n')}\n`;
}

// --- OSIS ------------------------------------------------------------------

function osisText({ meta, grouped, name }) {
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
        out.push(`        <verse osisID="${id}.${row.chapter}.${n}">${esc(verse.text)}</verse>`);
        if (verse.ref) out.push(`        <note type="crossReference">${esc(verse.ref)}</note>`);
      }
      out.push('      </chapter>');
    }
    out.push('    </div>');
  }
  out.push('  </osisText>', '</osis>');
  return `${out.join('\n')}\n`;
}

// --- Zefania ---------------------------------------------------------------

function zefaniaText({ meta, grouped, name }) {
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
        out.push(`      <VERS vnumber="${n}">${esc(verse.text)}</VERS>`);
      }
      out.push('    </CHAPTER>');
    }
    out.push('  </BIBLEBOOK>');
  }
  out.push('</XMLBIBLE>');
  return `${out.join('\n')}\n`;
}

// --- delimited -------------------------------------------------------------

function csvText({ grouped, name }) {
  const rows = ['book,book_name,chapter,verse,text,title'];
  for (const [book, chapters] of grouped) {
    for (const row of chapters) {
      for (const [n, verse] of versesOf(row)) {
        rows.push([book, name(book), row.chapter, n, verse.text, verse.title ?? ''].map(cell).join(','));
      }
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

function markdownText(book, chapters, { meta, name }) {
  const out = [`# ${name(book)}`, '', `> ${meta.info.name} (${meta.info.shortname}) · ${meta.info.language.text}`, ''];
  for (const row of chapters) {
    out.push(`## ${name(book)} ${row.chapter}`, '');
    for (const [n, verse] of versesOf(row)) {
      if (verse.title) out.push(`### ${verse.title}`, '');
      out.push(`**${n}${verse.merge ? `–${verse.merge}` : ''}** ${verse.text}`, '');
      if (verse.ref) out.push(`> ${verse.ref}`, '');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// --- shared ----------------------------------------------------------------

const ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

/** XML text and attribute escaping; the five predefined entities and no more. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
