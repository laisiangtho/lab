/**
 * The three XML Bibles: Zefania, OSIS and USFX.
 *
 * They disagree about almost everything except that a Bible is books,
 * containing chapters, containing verses — so they share one reader and differ
 * only in which element means what, and in whether a verse is a container or a
 * milestone:
 *
 *   Zefania  <BIBLEBOOK bnumber="1"><CHAPTER cnumber="1"><VERS vnumber="1">text
 *   OSIS     <div type="book" osisID="Gen"><chapter osisID="Gen.1">
 *              <verse osisID="Gen.1.1">text</verse>
 *   USFX     <book id="GEN"><c id="1"/><v id="1"/>text<ve/>
 *
 * USFX is the awkward one: `<c/>` and `<v/>` are empty markers and the text
 * that follows them belongs to them until the next marker. That is handled by
 * keeping a current position rather than a current element, which is what the
 * other two collapse to anyway.
 */

import { bookMatcher } from './books.js';
import { localName, readXml } from './xmlread.js';

/** Elements whose content is a note about the text rather than the text. */
const NOTES = new Set(['note', 'f', 'x', 'ef', 'fe', 'rq', 'catchword', 'reftext', 'ref', 'xt', 'fr', 'ft', 'fv', 'fq']);
/** Elements that are neither text nor structure — titles handled separately. */
const TITLES = new Set(['title', 's', 'ms', 'd', 'caption']);
/**
 * USX says with a `style` attribute what USFX says with an element name, so a
 * `<para>` is a heading, a cross-reference line, or the text itself depending
 * on what it is styled as.
 */
const PARA_TITLE = /^(s\d?|ms\d?|d|sr|sp)$/;
/** OSIS title types that name a book or a running head rather than a section. */
const BOOK_TITLE = /^(main|runninghead)$/i;
// A book's own title (`mt1`, `h`, `toc1`) names the book, not a section of it:
// taken as a heading it became the heading of verse 1 — "Genesis" over "In the
// beginning" in every USX import.
const PARA_NOTE = /^(r|rq|ip|iot|io\d?|ili\d?|im|ie|is\d?|rem|lit|mt\d?|mte\d?|imt\d?|h|toc\d?)$/;

/**
 * Which dialect a document is, by what it contains.
 * @returns {'zefania'|'osis'|'usfx'|'usx'|null}
 */
export function sniffXml(source) {
  const head = String(source ?? '').slice(0, 4000).toLowerCase();
  if (head.includes('<xmlbible') || head.includes('<biblebook')) return 'zefania';
  if (head.includes('<osis') || head.includes('osisid')) return 'osis';
  // USX before USFX: both carry `<book>`, and USX is the one with a `code`
  // attribute and `<para style=…>` around everything.
  if (head.includes('<usx') || /<book\s+code=/.test(head)) return 'usx';
  if (head.includes('<usfx') || /<book\s+id=/.test(head)) return 'usfx';
  return null;
}

/**
 * @param {string} source
 * @param {{ category: object, dialect?: string, source?: string }} options
 */
export function fromXml(source, { category, dialect = null, source: name = 'file' }) {
  const kind = dialect ?? sniffXml(source);
  if (!kind) throw new Error(`${name}: this XML is not Zefania, OSIS or USFX`);
  const books = bookMatcher(category);

  const out = {};
  const report = { books: 0, chapters: 0, verses: 0, titles: 0, notes: 0, dialect: kind, unknown: [] };
  const info = {};

  /** Where text is landing now. */
  let book = null;
  let chapter = null;
  let verse = null;
  /** How deep inside something to be ignored — a note, mostly. */
  let muted = 0;
  let title = '';
  let capturing = null;
  /** Book titles open and being skipped, so their close is told from a heading's. */
  let bookTitles = 0;
  /** Strong's numbers waiting for their word to finish. */
  const tagged = [];

  const put = (text) => {
    if (muted) return;
    // A heading is captured wherever it stands — several dialects put the
    // book's first one before the chapter it belongs to.
    if (capturing !== null) { capturing += text; return; }
    if (book === null || chapter === null || verse === null) return;
    const place = out[book].chapter[chapter].verse;
    const clean = text.replace(/\s+/g, ' ');
    if (!clean.trim() && !place[verse]) return;
    place[verse] = place[verse] ? { ...place[verse], text: place[verse].text + clean } : { text: clean };
  };

  /**
   * @param {number} n the verse
   * @param {number|null} to the last verse a range covers, which this app
   *        records as a `merge` — without it every merged verse in a real
   *        edition is reported as a chapter that disagrees with the canon.
   */
  const openVerse = (n, to = null) => {
    if (book === null || chapter === null || !Number.isFinite(n) || n < 1) return;
    verse = n;
    out[book].chapter[chapter].verse[verse] ??= { text: '' };
    if (to && to > n) out[book].chapter[chapter].verse[verse].merge = String(to);
    report.verses += 1;
    if (title) {
      out[book].chapter[chapter].verse[verse].title = title.replace(/\s+/g, ' ').trim();
      title = '';
      report.titles += 1;
    }
  };

  /** "3-4" → [3, 4]; "3" → [3, null]. */
  const spanOf = (value) => {
    const found = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?/.exec(String(value ?? ''));
    if (!found) return [NaN, null];
    return [Number.parseInt(found[1], 10), found[2] ? Number.parseInt(found[2], 10) : null];
  };

  const openChapter = (n) => {
    if (book === null || !Number.isFinite(n) || n < 1) return;
    chapter = n;
    verse = null;
    out[book].chapter[chapter] ??= { verse: {} };
    report.chapters += 1;
  };

  const openBook = (id) => {
    if (!id) { book = null; return; }
    out[id] ??= { chapter: {} };
    if (!report.seen?.has?.(id)) report.books += 1;
    (report.seen ??= new Set()).add(id);
    book = id;
    chapter = null;
    verse = null;
  };

  readXml(source, (event) => {
    if (event.kind === 'text') { put(event.text); return; }
    const tag = localName(event.name);

    if (event.kind === 'close') {
      if (NOTES.has(tag) && muted) muted -= 1;
      else if (TITLES.has(tag) && bookTitles && capturing === null) { bookTitles -= 1; muted -= 1; }
      // A title before any book is the file's own (OSIS `<header><work><title>`),
      // not a heading waiting for verse 1.
      else if (TITLES.has(tag) && capturing !== null) { title = book === null ? '' : capturing; capturing = null; }
      else if (tag === 'para') {
        if (capturing !== null) { title = capturing; capturing = null; }
        else if (muted) muted -= 1;
      } else if (tag === 'w' || tag === 'char') {
        // The word has just been written; its number follows it.
        const code = tagged.pop();
        if (code) put(code);
      } else if (kind === 'osis' && tag === 'verse') verse = null;
      return;
    }

    if (NOTES.has(tag)) { if (!event.empty) muted += 1; return; }
    if (TITLES.has(tag)) {
      if (event.empty) return;
      // OSIS names the book itself with a title too (`type="main"`); that one
      // is not a heading, and read as one it headed verse 1 with "Genesis".
      if (BOOK_TITLE.test(String(event.attrs.type ?? ''))) { bookTitles += 1; muted += 1; return; }
      capturing = '';
      return;
    }
    // A word carrying a Strong's number, in either dialect's spelling of it.
    // The number is kept inline, in the notation `core/strongs.js` reads.
    if (tag === 'w' || (tag === 'char' && String(event.attrs.style ?? '').toLowerCase() === 'w')) {
      const code = strongsOf(event.attrs);
      if (event.empty) { if (code) put(code); return; }
      tagged.push(code);
      return;
    }
    // USX carries the whole text inside `<para>`, and what a paragraph *is* is
    // in its style: a heading, an introduction nobody wants in a verse, or the
    // scripture itself.
    if (tag === 'para') {
      const style = String(event.attrs.style ?? '').toLowerCase();
      if (PARA_TITLE.test(style)) { if (!event.empty) capturing = ''; return; }
      if (PARA_NOTE.test(style)) { if (!event.empty) muted += 1; return; }
      return;
    }
    if (muted) return;

    const attrs = event.attrs;
    switch (tag) {
      // --- Zefania -------------------------------------------------------
      case 'biblebook':
        openBook(books.idFor(attrs.bnumber ?? attrs.bname ?? attrs.bsname));
        break;
      case 'chapter':
        // OSIS uses the same element name with an osisID, Zefania numbers it
        // `cnumber`, and USX `number`.
        if (attrs.cnumber) openChapter(Number.parseInt(attrs.cnumber, 10));
        else if (attrs.number) openChapter(Number.parseInt(attrs.number, 10));
        else if (attrs.osisid) openChapter(numberAfter(attrs.osisid, 1));
        else if (attrs.n) openChapter(Number.parseInt(attrs.n, 10));
        break;
      case 'vers':
      case 'verse': {
        if (attrs.vnumber) { openVerse(...spanOf(attrs.vnumber)); break; }
        // USX: a milestone with a number opens, one with an `eid` closes. The
        // number may be a range ("3-4"), and the first of it is the verse.
        if (attrs.number) { openVerse(...spanOf(attrs.number)); break; }
        if (attrs.eid && !attrs.sid) { verse = null; break; }
        const id = attrs.osisid ?? attrs.osisref ?? '';
        if (id) {
          // A milestone `<verse eID=…/>` closes rather than opens.
          if (attrs.eid) { verse = null; break; }
          const at = books.idFor(id);
          if (at && at !== book) openBook(at);
          const c = numberAfter(id, 1);
          if (c && c !== chapter) openChapter(c);
          openVerse(numberAfter(id, 2));
        } else if (attrs.n || attrs.id) {
          openVerse(...spanOf(attrs.n ?? attrs.id));
        }
        break;
      }
      // --- OSIS ----------------------------------------------------------
      case 'div':
        if ((attrs.type ?? '') === 'book') openBook(books.idFor(attrs.osisid ?? attrs.n));
        break;
      // --- USFX ----------------------------------------------------------
      case 'book':
        openBook(books.idFor(attrs.id ?? attrs.code ?? attrs.osisid));
        break;
      case 'c':
        openChapter(Number.parseInt(attrs.id ?? attrs.n ?? '', 10));
        break;
      case 'v':
        openVerse(...spanOf(attrs.id ?? attrs.n ?? ''));
        break;
      case 've':
        verse = null;
        break;
      // --- what the file calls itself -------------------------------------
      case 'information':
      case 'header':
      case 'work':
        break;
      default:
        break;
    }

    // The metadata elements every dialect spells differently, read wherever
    // they appear: a translation with no name at all cannot be installed, and
    // asking the reader for one they could have been told is rude.
    if (tag === 'xmlbible' || tag === 'usfx' || tag === 'osistext') {
      if (attrs.biblename) info.name = attrs.biblename;
      if (attrs.osisidwork) info.identify = String(attrs.osisidwork).toLowerCase();
      if (attrs['xml:lang'] || attrs.lang) info.language = attrs['xml:lang'] ?? attrs.lang;
    }
  });

  delete report.seen;
  if (!report.books) throw new Error(`${name}: no books could be read from this file`);
  return { raw: { book: out, info }, report };
}

/**
 * The Strong's number on a tagged word, however the dialect spells it.
 *
 * USFX puts it in `s`, USX in `strong`, and OSIS in a `lemma` of the form
 * `strong:H7225`. A word with several is written with several.
 */
function strongsOf(attrs) {
  const raw = attrs.s ?? attrs.strong ?? attrs.lemma ?? '';
  const codes = String(raw).split(/[,\s]+/)
    .map((part) => /(?:strong:)?([HG]?\d+[a-z]?)$/i.exec(part.trim())?.[1] ?? '')
    .filter(Boolean);
  return codes.map((code) => `{${code.toUpperCase()}}`).join('');
}

/** The nth number in a dotted OSIS id: "Gen.1.1" → 1 is the chapter. */
function numberAfter(id, index) {
  const parts = String(id ?? '').split('.');
  const n = Number.parseInt(parts[index] ?? '', 10);
  return Number.isFinite(n) ? n : null;
}
