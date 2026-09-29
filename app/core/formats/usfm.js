/**
 * USFM — the format a translation is actually worked in.
 *
 * A USFM file is plain text with backslash markers: `\c 3` starts a chapter,
 * `\v 16` a verse, `\p` a paragraph, and a long tail of markers for footnotes,
 * cross-references, poetry, titles and word-level tagging. Everything between
 * the verse marker and the next one is the verse.
 *
 * What this keeps: the text, the chapter and verse numbers, and section
 * headings (`\s`), which become `title` on the verse that follows them. What it
 * drops: footnotes and cross-references, which are notes *about* the text and
 * would otherwise be read aloud and searched as if they were scripture; and
 * every formatting marker, because this app lays the text out itself.
 *
 * What it does not do is pretend. USFM carries typography this app has no place
 * for — line breaks in poetry, small caps for the divine name, red letters —
 * and dropping them is a loss the reader should know about, which is why the
 * import reports what it found rather than only what it kept.
 *
 * Pure: text in, the app's own shape out.
 */

import { bookMatcher } from './books.js';

/** Markers whose content is a note about the text rather than the text. */
const NOTES = new Set(['f', 'fe', 'x', 'ef', 'efe', 'ex', 'fig', 'rq', 'va', 'vp']);
/** Markers that introduce a line of their own and end the verse's text. */
const BREAKS = /^(c|v|id|ide|h|toc\d?|toa\d?|mt\d?|ms\d?|mr|s\d?|sr|r|d|sp|cl|cp|cd|b|nb|lit|periph|rem|sts|restore|usfm)$/;

/**
 * @param {string} source the file
 * @param {{ category: object, source?: string }} options
 * @returns {{ raw: object, report: { books: number, chapters: number, verses: number,
 *             titles: number, notes: number, unknown: string[] } }}
 */
export function fromUsfm(source, { category, source: name = 'file' }) {
  const books = bookMatcher(category);
  const out = {};
  const report = { books: 0, chapters: 0, verses: 0, titles: 0, notes: 0, unknown: [] };
  const unknown = new Set();

  let book = null;
  let chapter = null;
  let verse = null;
  let pending = '';
  /** The last verse a range covers, for the verse being read now. */
  let spanTo = null;
  let idLine = '';
  let heading = '';

  const write = (text) => {
    if (book === null || chapter === null || verse === null) return;
    const clean = tidy(text);
    if (!clean) return;
    const place = out[book].chapter[chapter].verse;
    place[verse] = place[verse]
      ? { ...place[verse], text: `${place[verse].text} ${clean}`.trim() }
      : { text: clean };
    if (spanTo && spanTo > verse) place[verse].merge = String(spanTo);
    if (heading) {
      place[verse].title = heading;
      heading = '';
      report.titles += 1;
    }
  };

  const flush = () => { write(pending); pending = ''; };

  for (const token of tokenize(source)) {
    if (token.kind === 'text') { pending += token.text; continue; }

    const marker = token.marker;
    const base = marker.replace(/\*$/, '');

    if (NOTES.has(base)) {
      // `\f … \f*` — everything inside belongs to the note, and `tokenize`
      // has already skipped it. Counting them is how the import can say what
      // it left behind.
      report.notes += 1;
      continue;
    }

    if (!BREAKS.test(base)) {
      // A character or paragraph marker: it ends nothing, and its content is
      // still the verse. Unknown ones are recorded once, for the report.
      if (!KNOWN.test(base)) unknown.add(base);
      continue;
    }

    flush();

    if (base === 'id' || base === 'usfm') { idLine = token.rest.trim(); continue; }
    if (base === 'h' && book === null) { idLine = idLine || token.rest.trim(); continue; }

    if (base === 'c') {
      const n = Number.parseInt(token.rest, 10);
      if (!Number.isFinite(n) || n < 1) continue;
      if (book === null) book = openBook(out, books.idFor(firstWord(idLine)), report);
      if (book === null) continue;
      chapter = n;
      verse = null;
      out[book].chapter[chapter] ??= { verse: {} };
      report.chapters += 1;
      continue;
    }

    if (base === 'v') {
      const found = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*/.exec(token.rest);
      const n = found ? Number.parseInt(found[1], 10) : NaN;
      if (!Number.isFinite(n) || n < 1 || book === null || chapter === null) continue;
      verse = n;
      // `\v 3-4` is one verse in this app's shape *covering* two, which is
      // exactly what `merge` is for. Recording it is the difference between a
      // faithful import and one that reports every merged verse in the file as
      // a chapter that disagrees with the canon — fifty of them, on a real
      // edition, all of them the importer's fault rather than the file's.
      spanTo = found?.[2] ? Number.parseInt(found[2], 10) : null;
      report.verses += 1;
      pending = token.rest.slice(found[0].length);
      continue;
    }

    if (/^(s\d?|sr|ms\d?|d)$/.test(base)) { heading = tidy(token.rest); continue; }
  }
  flush();

  report.unknown = [...unknown].sort();
  if (!report.books) {
    throw new Error(`${name}: no book in this file — a USFM file names its book with \\id`);
  }
  return { raw: { book: out, info: { identify: firstWord(idLine).toLowerCase() } }, report };
}

function openBook(out, id, report) {
  if (!id) return null;
  if (!out[id]) { out[id] = { chapter: {} }; report.books += 1; }
  return id;
}

const firstWord = (line) => String(line ?? '').trim().split(/\s+/)[0] ?? '';

/** Markers this build knows about and deliberately ignores. */
const KNOWN = /^(p|m|pi\d?|pc|pr|pmo|pm|pmc|pmr|q\d?|qr|qc|qs|qa|qm\d?|li\d?|lh|lf|lim\d?|th\d?|thr\d?|tc\d?|tcr\d?|tr|add|bk|dc|k|nd|ord|pn|png|qt|sig|sls|tl|wj|em|bd|it|bdit|no|sc|sup|w|rb|pro|wg|wh|wa|ior|iqt|cat|ca|vp|fig|ndx|png)$/;

/**
 * The file as markers and text.
 *
 * Note bodies are consumed here rather than filtered later: `\f + \fr 1.1 \ft
 * note \f*` contains markers of its own, and treating them as ordinary content
 * would put a footnote's reference into the verse.
 */
function* tokenize(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  let at = 0;
  while (at < text.length) {
    const slash = text.indexOf('\\', at);
    if (slash === -1) { yield { kind: 'text', text: text.slice(at) }; return; }
    if (slash > at) yield { kind: 'text', text: text.slice(at, slash) };

    const found = /^\\([a-z][a-z0-9]*\*?)\s?/i.exec(text.slice(slash));
    if (!found) { yield { kind: 'text', text: '\\' }; at = slash + 1; continue; }
    const marker = found[1].toLowerCase();
    at = slash + found[0].length;

    const base = marker.replace(/\*$/, '');
    if (NOTES.has(base) && !marker.endsWith('*')) {
      // Everything to the closing marker is the note.
      const end = text.indexOf(`\\${base}*`, at);
      at = end === -1 ? text.length : end + base.length + 2;
      yield { kind: 'marker', marker, rest: '' };
      continue;
    }

    const next = text.indexOf('\\', at);
    const rest = text.slice(at, next === -1 ? text.length : next);
    // A line marker owns its line.
    if (BREAKS.test(base)) {
      at = next === -1 ? text.length : next;
      yield { kind: 'marker', marker, rest };
      continue;
    }
    // A character marker leaves its content in place as ordinary text — but
    // USFM 3 lets it carry attributes after a bar, `\w grace|strong="G5485"\w*`,
    // and those are about the word rather than part of the sentence. They can
    // only be found between the marker and the one that closes it, so that is
    // where they are taken out.
    if (!marker.endsWith('*')) {
      const end = text.indexOf(`\\${base}*`, at);
      if (end !== -1) {
        yield { kind: 'text', text: keepStrongs(text.slice(at, end)) };
        at = end + base.length + 2;
        continue;
      }
    }
    yield { kind: 'marker', marker, rest: '' };
  }
}

/**
 * A tagged word, with its Strong's number kept.
 *
 * `\\w grace|strong="G5485"\\w*` carries the one piece of word-level markup this
 * app has any use for. It used to be thrown away wholesale — the importer
 * dropped the attributes because it expected a `word` field that nothing in the
 * app ever read or wrote, so a KJV published with its Strong's numbers arrived
 * without them. The number is now kept inline, in the notation
 * `core/strongs.js` already reads, which is the notation the reading surface
 * already renders.
 *
 * `x-...` attributes, lemmas and morphology are dropped: nothing shows them.
 */
function keepStrongs(inner) {
  const bar = inner.indexOf('|');
  if (bar === -1) return inner;
  const word = inner.slice(0, bar);
  const attrs = inner.slice(bar + 1);
  // `strong="G5485"` or `strong="H430,H1234"`, and the bare form `|G5485`.
  const found = /strong\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]
    ?? (/^\s*([HG]?\d+[a-z]?)\s*$/i.exec(attrs)?.[1] ?? '');
  if (!found) return word;
  const codes = found.split(/[,\s]+/).filter(Boolean).map((code) => `{${code.toUpperCase()}}`);
  return `${word}${codes.join('')}`;
}

/**
 * A verse's text, as text.
 *
 * `\w grace|strong="G5485"\w*` puts a word's tagging inline; the word is kept
 * and the tagging dropped, because this build reads Strong's numbers from its
 * own `word` field rather than from the middle of a sentence.
 */
function tidy(value) {
  return String(value ?? '')
    .replace(/[\t\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}
