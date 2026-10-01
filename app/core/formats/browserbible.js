/**
 * browserBible: a translation as the Digital Bible Society's browser reader
 * publishes it — eBible.org's `<id>_browserBible.zip`, among others.
 *
 * The archive is a folder of pages, one per chapter, named by the Digital
 * Bible Society's two-character book code and the chapter (`GN1.html`,
 * `S1.html` for 1 Samuel, `R1` for 1 Chronicles), with an `info.json` that
 * names the translation, its language and direction, and its own names for
 * the books. Inside a chapter page:
 *
 *   <div class="section chapter GN GN1 …" lang="en" dir="ltr">
 *     <div class="c">1</div>
 *     <div class="p">
 *       <span class="v-num v-1">1&nbsp;</span>
 *       <span class="v GN1_1" data-id="GN1_1"><l s="H7225">In the beginning</l> …</span>
 *
 * A verse broken across poetry lines is several `v` spans with the same id,
 * joined here. `<l s="H853 H1254" m="HVqp3ms">` is a tagged word, written in
 * this app's notation (`created{H853}{H1254:HVqp3ms}`). `d`, `s` and `ms`
 * blocks are headings, which go on the verse that follows; notes (`note`),
 * cross-references (`cf`), the verse numbers and the page's footnotes are
 * left out and counted.
 *
 * The `index/` and `indexlemma/` folders beside the pages are browserBible's
 * search indexes: word → verses and Strong's number → verses. They are
 * derived from the same text, so they are not read — this app builds its own
 * from the text it keeps, which cannot disagree with it.
 *
 * Pure: the caller unpacks the archive and passes text.
 */

import { DBS } from './books.js';
import { tagNotation } from '../strongs.js';

const CHAPTER_FILE = /^([A-Z0-9]{2})(\d{1,3})\.html$/;
const HEADING = new Set(['d', 's', 's1', 's2', 's3', 'ms', 'ms1', 'ms2', 'mr', 'sr', 'qa']);
const SKIP_SPAN = new Set(['note', 'cf', 'v-num', 'key', 'backref', 'footnote']);
const VOID = new Set(['br', 'meta', 'link', 'img', 'hr', 'input', 'wbr', 'col', 'area', 'source']);
const SKIP_DIV = new Set(['c', 'mt', 'mt1', 'mt2', 'mt3', 'header', 'footer', 'footnotes', 'nav', 'is', 'ip', 'imt', 'io']);

/** Whether a set of files is a browserBible text. */
export function isBrowserBible(files) {
  const names = (files ?? []).map((file) => baseName(file.name));
  return names.includes('info.json') && names.filter((name) => CHAPTER_FILE.test(name)).length >= 1
    && (files ?? []).some((file) => CHAPTER_FILE.test(baseName(file.name)) && /class="v [A-Z0-9]{2}\d+_\d+/.test(file.text));
}

/**
 * @param {{ name: string, text: string }[]} files
 * @param {{ info?: object, source?: string }} [options]
 * @returns {{ raw: object, report: object }}
 */
export function readBrowserBible(files, { info = {}, source = 'browserBible' } = {}) {
  const infoFile = files.find((file) => baseName(file.name) === 'info.json');
  if (!infoFile) throw new Error(`${source}: no info.json — this is not a browserBible text`);
  let meta;
  try { meta = JSON.parse(infoFile.text); } catch (err) {
    throw new Error(`${source}: info.json is not JSON (${err.message})`);
  }

  // The translation's own book names, by code, where info.json lists them.
  const ownNames = new Map();
  (meta.divisions ?? []).forEach((code, i) => {
    const name = meta.divisionNames?.[i];
    if (name) ownNames.set(String(code), String(name));
  });

  const book = {};
  const report = {
    format: 'browserbible', files: 0, books: 0, chapters: 0, verses: 0, notes: 0, strongs: 0, named: 0,
    skipped: [], indexes: false,
  };
  const unknown = new Set();
  for (const file of files) {
    const name = baseName(file.name);
    if (/(^|\/)index(lemma)?\//.test(file.name) || /^_[A-Z]?\d+\.json$/.test(name)) { report.indexes = true; continue; }
    const found = CHAPTER_FILE.exec(name);
    if (!found) continue;
    const id = DBS.indexOf(found[1]) + 1;
    if (id < 1) { unknown.add(found[1]); continue; }
    const chapter = Number(found[2]);
    if (chapter < 1) continue; // an introduction page
    const verses = readChapter(file.text, id, report);
    if (!Object.keys(verses).length) continue;
    report.files += 1;
    if (!book[id]) {
      book[id] = { chapter: {} };
      report.books += 1;
      const own = ownNames.get(found[1]);
      if (own) { book[id].info = { name: own }; report.named += 1; }
    }
    book[id].chapter[chapter] = { verse: verses };
    report.chapters += 1;
  }
  if (!report.books) throw new Error(`${source}: no chapter pages could be read — looked at ${files.length} files`);
  report.skipped = [...unknown].map((code) => `${code}*.html (a book outside the 66)`);

  const wanted = {
    name: meta.name || meta.nameEnglish || '',
    shortname: meta.abbr || '',
    // The direction info.json states is kept; the language code is the
    // ISO 639-3 one browserBible uses.
    language: {
      name: String(meta.lang ?? '').trim(),
      text: String(meta.langNameEnglish || meta.langName || '').trim(),
      textdirection: meta.dir === 'rtl' ? 'rtl' : 'ltr',
    },
    ...(meta.id ? { identify: String(meta.id).toLowerCase().replace(/[^a-z0-9]+/g, '') } : {}),
  };
  const given = Object.fromEntries(Object.entries(info ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  // A language the reader typed is a code; it replaces the code info.json
  // gave and keeps the direction info.json states, which a bare code loses.
  if (typeof given.language === 'string') {
    wanted.language = { ...wanted.language, name: given.language.trim() };
    if (given.language.trim() !== String(meta.lang ?? '').trim()) wanted.language.text = '';
    delete given.language;
  }
  Object.assign(wanted, given);
  return {
    raw: { identify: wanted.identify ?? '', version: 1, info: { ...wanted, version: 1 }, book },
    report,
  };
}

/**
 * One chapter page's verses.
 * @returns {Record<number, { text: string, title?: string, merge?: string }>}
 */
function readChapter(html, book, report) {
  const start = html.search(/<div class="section chapter/);
  const end = html.search(/<div class="footnotes"/);
  const body = html.slice(start < 0 ? 0 : start, end > start ? end : undefined).replace(/<!--[\s\S]*?-->/g, '');
  const letter = book <= 39 ? 'H' : 'G';
  const verses = {};
  /** What each open element is: 'skip', 'heading', 'verse', 'word' or 'plain'. */
  const stack = [];
  let skipping = 0;
  let heading = null;
  let pendingTitle = '';
  let verse = null;
  const words = [];

  const put = (text) => {
    if (skipping) return;
    if (heading !== null) { heading += text; return; }
    if (verse === null) return;
    verses[verse].text += text;
  };

  for (const match of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g)) {
    if (match[4] !== undefined) { put(decode(match[4])); continue; }
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3];
    if (/\/\s*$/.test(attrs) || VOID.has(tag)) { if (tag === 'br') put(' '); continue; }
    if (closing) {
      const role = stack.pop();
      if (role === 'skip') skipping -= 1;
      else if (role === 'heading') {
        const said = (heading ?? '').replace(/\s+/g, ' ').trim();
        heading = null;
        if (said) pendingTitle = pendingTitle ? `${pendingTitle} ${said}` : said;
      } else if (role === 'word') {
        const word = words.pop();
        if (word && !skipping && verse !== null) {
          const notation = tagNotation([word.s], { morph: word.m, letter });
          if (notation) { verses[verse].text += notation; report.strongs += 1; }
        }
      }
      continue;
    }
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const first = cls.split(/\s+/)[0];
    if (tag === 'div' && (SKIP_DIV.has(first) || skipping)) { stack.push('skip'); skipping += 1; continue; }
    if (tag === 'div' && HEADING.has(first)) { stack.push('heading'); heading = ''; continue; }
    if (tag === 'span' && SKIP_SPAN.has(first)) {
      if (first === 'note' || first === 'cf') report.notes += 1;
      stack.push('skip'); skipping += 1; continue;
    }
    if (tag === 'span' && first === 'v') {
      const id = /data-id="[A-Z0-9]{2}\d+_(\d+)(?:-(\d+))?"/.exec(attrs) ?? /\bv [A-Z0-9]{2}\d+_(\d+)(?:-(\d+))?/.exec(cls);
      if (id) {
        const n = Number(id[1]);
        if (!verses[n]) {
          verses[n] = { text: '' };
          report.verses += 1;
          if (id[2] && Number(id[2]) > n) verses[n].merge = String(Number(id[2]));
          if (pendingTitle) { verses[n].title = pendingTitle; pendingTitle = ''; }
        } else if (verses[n].text && !/\s$/.test(verses[n].text)) {
          // The same verse, continued on the next line of a poem.
          verses[n].text += ' ';
        }
        verse = n;
      }
      stack.push('verse');
      continue;
    }
    if (tag === 'l') {
      words.push({ s: /\ss="([^"]*)"/.exec(attrs)?.[1] ?? '', m: /\sm="([^"]*)"/.exec(attrs)?.[1] ?? null });
      stack.push('word');
      continue;
    }
    stack.push('plain');
  }

  for (const entry of Object.values(verses)) entry.text = entry.text.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  for (const [n, entry] of Object.entries(verses)) if (!entry.text) delete verses[n];
  return verses;
}

const baseName = (name) => String(name ?? '').split('/').pop();

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}
