/**
 * A translation as it is actually published: a folder of files, not one file.
 *
 * eBible.org hands out `engkjvcpb_usfx.zip`, and what is inside it is the
 * reason it is worth taking whole:
 *
 *   engkjvcpb_usfx.xml            the scripture, with its Strong's numbers
 *   BookNames.xml                 what this translation calls each book
 *   engkjvcpbmetadata.xml         its name, abbreviation, language, rights
 *   copr.htm                      the copyright notice, in full
 *   dejavuserif.css, keys.asc     nothing to do with us
 *
 * Asking a reader to unpack that and hand us one file out of eight is asking
 * them to do the assembly we are better placed to do — and it throws away the
 * book names and the metadata, which is most of what makes an import feel like
 * an installed translation rather than a wall of numbered chapters.
 *
 * So this takes the whole set and works out what each file is by what is in it.
 * A USFM bundle is sixty-six scripture files and this merges them; a USFX
 * bundle is one. Files it does not recognise are listed in the report rather
 * than silently ignored, because a reader looking at "4 files were not used"
 * can tell us what we missed.
 *
 * Pure: the caller unpacks the archive (`services/zip.js`) and passes text.
 */

import { USFM } from './books.js';
import { convert, sniff } from './index.js';
import { localName, readXml } from './xmlread.js';

/**
 * @typedef {{ name: string, text: string }} PackFile
 */

/** Files that are never scripture, whatever else is true of them. */
const IGNORE = /(^|\/)(?:keys\.asc|.*\.(?:css|htm|html|txt|md|pdf|jpg|png|svg|zip|asc|sig))$/i;
/** The metadata files a bundle carries, by what they are called. */
const IS_META = /metadata\.xml$|(^|\/)metadata\.xml$|\.dblmeta$/i;
const IS_BOOKNAMES = /booknames\.xml$/i;
const IS_COPYRIGHT = /copr\.(?:htm|html)$/i;

/**
 * What each file in a bundle is.
 *
 * Shared with the import dialog, which has to say what it found before anything
 * is assembled — and which was counting the copyright notice as scripture until
 * it asked the same question the same way.
 *
 * @param {PackFile[]} files
 */
export function classify(files) {
  const usable = (files ?? []).filter((file) => file.name && !file.name.endsWith('/'));
  const meta = usable.find((f) => IS_META.test(f.name)) ?? null;
  const names = usable.find((f) => IS_BOOKNAMES.test(f.name)) ?? null;
  const rights = usable.find((f) => IS_COPYRIGHT.test(f.name)) ?? null;
  const scripture = usable.filter((file) => {
    if (file === meta || file === names || file === rights) return false;
    if (IGNORE.test(file.name)) return false;
    return sniff(file.text, file.name).some((guess) => guess.confidence >= 0.5);
  });
  const other = usable.filter((file) => !scripture.includes(file)
    && file !== meta && file !== names && file !== rights);
  return { usable, meta, names, rights, scripture, other };
}

/**
 * eBible.org publishes each translation in several shapes, and only some of
 * them are a Bible this app can read. The others are recognised so the reader
 * is told which download to take instead, rather than "no scripture file":
 *
 *   <id>_readaloud.zip     a chapter to a text file, verse numbers taken out
 *                          so a speech engine does not read them — nothing
 *                          left to say which verse is which
 *   <id>_browserBible.zip  pages built for one web reader
 *   <id>_html.zip          the website, a chapter to a page
 *
 * `<id>_usfx.zip` is the same translation as data: verses, book names,
 * metadata, copyright and, for a tagged edition, its Strong's numbers.
 *
 * @param {PackFile[]} files
 * @param {string} archiveName
 * @returns {{ kind: 'readaloud'|'browserbible'|'html', id: string, instead: string } | null}
 */
export function otherEdition(files, archiveName = '') {
  const base = String(archiveName).split(/[\\/]/).pop();
  const names = (files ?? []).map((file) => String(file.name ?? '').split('/').pop());
  const idFrom = (name) => /^([a-z0-9-]+?)_/i.exec(name)?.[1] ?? '';
  const pick = (kind, from) => {
    const id = idFrom(base) || idFrom(from ?? '') || '';
    return { kind, id, instead: id ? `${id}_usfx.zip` : 'the USFX zip' };
  };
  if (/_readaloud\.zip$/i.test(base)) return pick('readaloud');
  const read = names.find((name) => /_read\.txt$/i.test(name));
  if (read) return pick('readaloud', read);
  if (/_browserbible\.zip$/i.test(base)) return pick('browserbible');
  const pages = (pattern) => names.filter((name) => pattern.test(name)).length;
  if (names.includes('info.json') && pages(/^[A-Z0-9]{2}\d{1,3}\.html$/) >= 5) return pick('browserbible');
  if (/_html\.zip$/i.test(base)) return pick('html');
  if (pages(/^[A-Z0-9]{3}\d{2,3}\.htm$/) >= 5) return pick('html');
  return null;
}

/**
 * Read a published bundle.
 *
 * @param {PackFile[]} files every file in the archive
 * @param {{ category: object, info?: object, source?: string }} options
 * @returns {{ raw: object, report: object }} the same pair a single-file
 *          adapter returns, ready for `parseTranslation`
 */
export function readPack(files, { category, info = {}, source = 'archive' }) {
  const { usable, meta, names, rights, scripture } = classify(files);
  if (!scripture.length) {
    const other = otherEdition(files, source);
    if (other) throw new Error(`${source}: this is eBible.org's ${other.kind} edition, which has no verses to read; take ${other.instead} instead`);
    throw new Error(`${source}: no scripture file in this archive — looked at ${usable.length} files`);
  }

  // One format for the bundle: a USFM bundle is sixty-six USFM files, and a
  // file in it that sniffs as something else is a file we have misread.
  const votes = new Map();
  for (const file of scripture) {
    const best = sniff(file.text, file.name)[0];
    votes.set(best.id, (votes.get(best.id) ?? 0) + 1);
  }
  const format = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const declared = meta ? readMetadata(meta.text) : {};
  const wanted = {
    ...declared,
    ...(rights ? { copyright: plainText(rights.text).slice(0, 2000) } : {}),
    ...clean(info),
  };

  const book = {};
  const report = {
    format, files: scripture.length, books: 0, chapters: 0, verses: 0, notes: 0,
    strongs: 0, named: 0, skipped: [], from: meta ? 'metadata' : 'files',
  };

  for (const file of scripture) {
    // Each scripture file is converted on its own and the books merged: a
    // bundle is not one document, and pretending otherwise would mean
    // concatenating USFM files and hoping `\id` lines behave.
    const piece = convert({
      text: file.text,
      format,
      source: file.name,
      category,
      info: wanted,
    });
    for (const [id, entry] of Object.entries(piece.raw.book ?? {})) {
      if (!book[id]) { book[id] = entry; report.books += 1; continue; }
      // Two files covering the same book: merge the chapters rather than lose
      // one, which is what a split-by-chapter bundle needs.
      book[id].chapter = { ...book[id].chapter, ...entry.chapter };
    }
    report.notes += piece.report.notes ?? 0;
  }

  for (const entry of Object.values(book)) {
    for (const chapter of Object.values(entry.chapter ?? {})) {
      report.chapters += 1;
      for (const verse of Object.values(chapter.verse ?? {})) {
        report.verses += 1;
        if (/\{[HG]?\d/.test(verse.text ?? '')) report.strongs += 1;
      }
    }
  }

  if (names) {
    const found = readBookNames(names.text);
    for (const [id, naming] of Object.entries(found)) {
      if (!book[id]) continue;
      book[id].info = { ...book[id].info, ...naming };
      report.named += 1;
    }
  }

  report.skipped = classify(files).other.map((file) => file.name).slice(0, 12);

  return {
    raw: {
      identify: wanted.identify ?? '',
      version: wanted.version ?? 1,
      info: { ...wanted, version: wanted.version ?? 1 },
      book,
    },
    report,
  };
}

/**
 * The bundle's own metadata.
 *
 * eBible ships Digital Bible Library metadata, which is a deep document with
 * one useful paragraph in it. Only the fields this app has somewhere to put are
 * read; the rest is left where it is.
 */
export function readMetadata(source) {
  const out = {};
  const path = [];
  /**
   * The text of each open element, so that a value wrapped in markup — and a
   * copyright statement always is — is read whole. A walker that keeps only the
   * text since the last tag sees "Someone" where the file says
   * "© 1999 <b>Someone</b>."
   */
  const held = [];

  readXml(source, (event) => {
    if (event.kind === 'text') {
      if (held.length) held[held.length - 1] += event.text;
      return;
    }
    if (event.kind === 'open') {
      if (event.empty) return;
      path.push(localName(event.name));
      held.push('');
      return;
    }
    const tag = path.pop();
    const value = (held.pop() ?? '').trim();
    // A closed element's text belongs to its parent too.
    if (held.length) held[held.length - 1] += ` ${value} `;
    if (!tag || !value) return;
    const where = `${path.join('/')}/${tag}`.toLowerCase();

    if (/identification\/(name|namelocal)$/.test(where) && !out.name) out.name = value;
    else if (/identification\/abbreviation(local)?$/.test(where) && !out.shortname) out.shortname = value.slice(0, 12);
    else if (/identification\/systemid$/.test(where) && !out.identify) out.identify = value;
    else if (/language\/iso$/.test(where)) out.language = value;
    else if (/language\/name$/.test(where) && !out.languageText) out.languageText = value;
    else if (/language\/scriptdirection$/.test(where)) out.textdirection = value.toLowerCase() === 'rtl' ? 'rtl' : 'ltr';
    else if (/copyright\/fullstatement$/.test(where) && !out.copyright) out.copyright = plainText(value).slice(0, 2000);
    else if (/\/(?:datecompleted|date)$/.test(where) && !out.year) out.year = (/\d{4}/.exec(value)?.[0] ?? '');
  });
  return out;
}

/**
 * `BookNames.xml` — what this translation calls each book, which is the
 * difference between a Burmese Bible whose books read in Burmese and one whose
 * books read in English.
 *
 * @returns {Record<string, { name: string, shortname: string, abbr: string[] }>}
 */
export function readBookNames(source) {
  const out = {};
  readXml(source, (event) => {
    if (event.kind !== 'open' || localName(event.name) !== 'book') return;
    const code = String(event.attrs.code ?? event.attrs.id ?? '').toUpperCase();
    const id = CODE_TO_ID[code];
    if (!id) return;
    const long = event.attrs.long ?? '';
    const short = event.attrs.short ?? '';
    const abbr = event.attrs.abbr ?? '';
    const name = short || long || abbr;
    if (!name) return;
    out[id] = {
      name,
      shortname: abbr || short.slice(0, 4) || name.slice(0, 4),
      abbr: [abbr, short, long].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i),
    };
  });
  return out;
}

/** Markup out, text in: a copyright notice arrives as HTML. */
function plainText(value) {
  return String(value ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(info) {
  return Object.fromEntries(Object.entries(info ?? {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
}

/** USFM code → canon id, from the table every reader here already shares. */
const CODE_TO_ID = Object.fromEntries(USFM.map((code, i) => [code, i + 1]));
