/**
 * Study data a reader brings: cross-references, a topical index, a Bible
 * dictionary. Each arrives in the shape its publisher gives it, and this
 * turns it into one of three shapes the app keeps.
 *
 *   crossrefs   verse → the verses it points to, with a weight
 *   topics      a topic → the verses filed under it
 *   dictionary  a term → an article, its verse references marked
 *
 * Formats read:
 *
 *   OpenBible.info cross-references  tab-separated, a header of
 *       "From Verse  To Verse  Votes  #www.openbible.info CC-BY <date>",
 *       then one link a line in OSIS references:
 *       "Gen.1.1  Rom.1.19-Rom.1.20  55". Votes may be negative: readers
 *       voted the link down. Kept, and left for the reader of the data to
 *       weigh.
 *   CCEL ThML glossaries  Easton's Bible Dictionary, Nave's Topical Bible and
 *       the other reference works the Christian Classics Ethereal Library
 *       publishes as ThML: <term> then <def>, verse references marked
 *       <scripRef osisRef="Bible:Exod.4.27-Exod.4.30">. Read as a dictionary
 *       or as a topical index — the same markup carries both.
 *   This app's own JSON  { app: "lai-siangtho", kind: "studydata",
 *       schema: 1, type, name, source, licence, … } with the shape below.
 *
 * A verse reference is kept as [book, chapter, verse, toChapter, toVerse]:
 * one verse repeats itself, a range ends elsewhere, a whole chapter has verse
 * 0. Strict about what a file is, and about references it cannot place: a
 * book this canon does not know is an error naming the line, not a link
 * quietly dropped.
 *
 * Pure.
 */

import { fail } from './errors.js';
import { OSIS } from './formats/books.js';

export const STUDY_SCHEMA = 1;
export const STUDY_TYPES = Object.freeze(['crossrefs', 'topics', 'dictionary']);

const OSIS_ID = new Map(OSIS.map((code, i) => [code.toLowerCase(), i + 1]));

/** What a text is, of the formats above: { format, type } or null. */
export function sniffStudy(text) {
  const head = String(text ?? '').replace(/^﻿/, '').slice(0, 4000);
  if (/^From Verse\tTo Verse\tVotes/.test(head)) return { format: 'openbible', type: 'crossrefs' };
  if (/<ThML[\s>]/.test(head) && /<glossary[\s>]|<term[\s>]/.test(String(text))) return { format: 'thml', type: null };
  if (/^\s*\{/.test(head) && /"kind"\s*:\s*"studydata"/.test(head)) return { format: 'json', type: null };
  return null;
}

/**
 * Read a study file.
 *
 * @param {string} text
 * @param {{ source: string, type?: 'crossrefs'|'topics'|'dictionary' }} options
 *        `type` decides how a ThML glossary is read; without it, a glossary
 *        whose entries are mostly references is a topical index
 * @returns {{ type: string, format: string, name: string, source: string, licence: string,
 *             count: number, links?: Record<string, number[][]>, entries?: object[] }}
 */
export function readStudyFile(text, { source, type = null }) {
  const found = sniffStudy(text);
  if (!found) fail(source, '$', 'not study data this app reads: expected OpenBible.info cross-references, a CCEL ThML dictionary or topical index, or this app\'s JSON');
  if (type && !STUDY_TYPES.includes(type)) fail(source, '$', `no study data type "${type}"`);
  if (found.format === 'openbible') {
    if (type && type !== 'crossrefs') fail(source, '$', `this is a cross-reference list, not a ${type}`);
    return readOpenBible(text, { source });
  }
  if (found.format === 'thml') return readThml(text, { source, type });
  return readJson(text, { source, type });
}

// --- references -----------------------------------------------------------

/**
 * "Gen.1.1", "Rom.1.19-Rom.1.20", "Bible:Lev.8", "Exod.4.27-Exod.4.30" →
 * [book, chapter, verse, toChapter, toVerse]; null for a book outside the
 * canon (the deuterocanon is not in it).
 */
export function readOsisRef(ref) {
  const [from, to] = String(ref ?? '').replace(/^Bible[^:]*:/i, '').trim().split('-');
  const start = osisPoint(from);
  if (!start) return null;
  const end = to ? osisPoint(to, start) : null;
  // A range that runs into another book is kept as its first verse: the
  // reference still says where to go.
  if (!end || end.book !== start.book) return [start.book, start.chapter, start.verse, start.chapter, start.verse];
  return [start.book, start.chapter, start.verse, end.chapter, end.verse];
}

function osisPoint(part, base = null) {
  const bits = String(part ?? '').trim().split('.');
  // The end of a range may name only a verse ("Gen.1.1-3"); OpenBible
  // always writes it whole.
  if (base && bits.length === 1 && /^\d+$/.test(bits[0])) return { book: base.book, chapter: base.chapter, verse: Number(bits[0]) };
  const book = OSIS_ID.get(String(bits[0] ?? '').toLowerCase());
  if (!book) return null;
  const chapter = Number(bits[1] ?? 1);
  const verse = bits[2] === undefined ? 0 : Number(bits[2]);
  if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 0) return null;
  return { book, chapter, verse };
}

/** "b.c" of a reference: the chapter it is filed under. */
export const chapterKey = (ref) => `${ref[0]}.${ref[1]}`;

// --- OpenBible.info ---------------------------------------------------------

function readOpenBible(text, { source }) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const header = lines[0].split('\t');
  const credit = header.slice(3).join(' ').replace(/^#\s*/, '').trim();
  /** "b.c" → [[book, chapter, verse, toBook-free target…]]: [fromVerse, b, c, v, c2, v2, votes] */
  const links = {};
  let count = 0;
  let outside = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const [fromText, toText, votesText] = line.split('\t');
    const from = readOsisRef(fromText);
    const to = readOsisRef(toText);
    // OpenBible covers the 66 books; a reference to anything else is a line
    // this canon cannot place, and is counted rather than guessed at.
    if (!from || !to) {
      if (!/^[1-4]?[A-Za-z]+\./.test(fromText ?? '') || !/^[1-4]?[A-Za-z]+\./.test(toText ?? '')) fail(source, `line ${i + 1}`, `cannot read "${line.slice(0, 60)}"`);
      outside += 1;
      continue;
    }
    const votes = Number(votesText);
    if (!Number.isFinite(votes)) fail(source, `line ${i + 1}`, `the votes are not a number: "${votesText}"`);
    (links[chapterKey(from)] ??= []).push([from[2], ...to, votes]);
    count += 1;
  }
  if (!count) fail(source, '$', 'no cross-references in this file');
  return {
    type: 'crossrefs',
    format: 'openbible',
    name: 'OpenBible.info cross-references',
    source: `OpenBible.info${credit ? ` — ${credit}` : ''}`,
    licence: /CC-?BY/i.test(credit) ? 'CC BY — https://creativecommons.org/licenses/by/4.0/' : '',
    count,
    outside,
    links,
  };
}

// --- CCEL ThML ---------------------------------------------------------------

function readThml(text, { source, type }) {
  const title = decode(stripTags(/<DC\.Title>([\s\S]*?)<\/DC\.Title>/.exec(text)?.[1] ?? '')).trim()
    || decode(stripTags(/<title>([\s\S]*?)<\/title>/.exec(text)?.[1] ?? '')).trim();
  const published = /<published>([\s\S]*?)<\/published>/.exec(text)?.[1]?.trim() ?? '';
  const entries = [];
  const pairs = /<term\b[^>]*>([\s\S]*?)<\/term>\s*<def\b[^>]*>([\s\S]*?)<\/def>/g;
  let refs = 0;
  let prose = 0;
  for (const [, termHtml, defHtml] of text.matchAll(pairs)) {
    const term = decode(stripTags(termHtml)).replace(/\s+/g, ' ').trim();
    if (!term) continue;
    const body = paragraphs(defHtml);
    const entryRefs = body.flatMap((para) => para.filter((seg) => typeof seg !== 'string').map((seg) => seg.r));
    refs += entryRefs.length;
    prose += body.flat().filter((seg) => typeof seg === 'string').join('').replace(/[\s.,;:()]+/g, ' ').length;
    entries.push({ term, body, refs: entryRefs });
  }
  if (!entries.length) fail(source, '$', 'a ThML file with no <term>/<def> entries in it — not a dictionary or topical index');
  // A topical index is lists of verses with a few words between them; a
  // dictionary is articles. Asked, the reader decides; otherwise, the words
  // between the references decide.
  const guessed = prose / Math.max(refs, 1) < 40 ? 'topics' : 'dictionary';
  const kind = type ?? guessed;
  if (kind === 'crossrefs') fail(source, '$', 'a ThML reference work is a dictionary or a topical index, not a cross-reference list');
  const name = title || (kind === 'topics' ? 'Topical index' : 'Bible dictionary');
  return {
    type: kind,
    format: 'thml',
    name,
    source: `${name}${published ? ` (${published})` : ''} — Christian Classics Ethereal Library (ccel.org) ThML edition`,
    licence: 'The text is public domain; the ThML edition is CCEL\'s',
    count: entries.length,
    entries: kind === 'topics'
      ? entries.map(({ term, body, refs: list }) => ({ term, note: shortNote(body), refs: list }))
      : entries.map(({ term, body }) => ({ term, body })),
  };
}

/** A definition as paragraphs, each a list of text and { r: ref, t: label }. */
function paragraphs(html) {
  const blocks = html.split(/<\/p>/i).map((block) => block.replace(/<p\b[^>]*>/gi, ''));
  const out = [];
  for (const block of blocks) {
    const para = [];
    let at = 0;
    for (const match of block.matchAll(/<scripRef\b([^>]*)>([\s\S]*?)<\/scripRef>/g)) {
      const before = clean(block.slice(at, match.index));
      if (before) para.push(before);
      const osis = /osisRef="([^"]*)"/.exec(match[1])?.[1] ?? '';
      const label = clean(match[2]);
      // A reference ThML gives several places at once ("Bible:Gen.1.1 Bible:Gen.2.4") is its first.
      const ref = readOsisRef(osis.split(/\s+/)[0]);
      if (ref) para.push({ r: ref, t: label });
      else if (label) para.push(label);
      at = match.index + match[0].length;
    }
    const after = clean(block.slice(at));
    if (after) para.push(after);
    // Spaces around a reference are kept; those at the paragraph's ends are not.
    if (typeof para[0] === 'string') para[0] = para[0].trimStart();
    if (typeof para[para.length - 1] === 'string') para[para.length - 1] = para[para.length - 1].trimEnd();
    const kept = para.filter((seg) => typeof seg !== 'string' || seg);
    if (kept.some((seg) => typeof seg !== 'string' || seg.trim())) out.push(kept);
  }
  return out;
}

/** The words of a topic's entry with its references taken out: what a topic says about itself. */
function shortNote(body) {
  return body.flat().filter((seg) => typeof seg === 'string').join(' ')
    .replace(/\(\s*[;,.\s]*\)/g, '').replace(/[\s;,.:]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function clean(html) {
  return decode(stripTags(html)).replace(/\s+/g, ' ');
}

const stripTags = (html) => String(html ?? '').replace(/<[^>]+>/g, '');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
function decode(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

// --- this app's JSON ---------------------------------------------------------

function readJson(text, { source, type }) {
  let raw;
  try { raw = JSON.parse(text); } catch (err) { fail(source, '$', `not JSON (${err.message})`); }
  if (raw?.app !== 'lai-siangtho' || raw.kind !== 'studydata') fail(source, '$', 'not this app\'s study data');
  if (raw.schema !== STUDY_SCHEMA) fail(source, '$.schema', `this build reads schema ${STUDY_SCHEMA}, the file says ${JSON.stringify(raw.schema)}`);
  if (!STUDY_TYPES.includes(raw.type)) fail(source, '$.type', `expected one of ${STUDY_TYPES.join(', ')}, got ${JSON.stringify(raw.type)}`);
  if (type && type !== raw.type) fail(source, '$.type', `this file is ${raw.type}, not ${type}`);
  const base = { type: raw.type, format: 'json', name: String(raw.name ?? '') || raw.type, source: String(raw.source ?? ''), licence: String(raw.licence ?? '') };
  if (raw.type === 'crossrefs') {
    if (!raw.links || typeof raw.links !== 'object') fail(source, '$.links', 'expected an object of chapter → links');
    const count = Object.values(raw.links).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    return { ...base, count, links: raw.links };
  }
  if (!Array.isArray(raw.entries)) fail(source, '$.entries', 'expected a list of entries');
  return { ...base, count: raw.entries.length, entries: raw.entries };
}

// --- reading what was kept ----------------------------------------------------

/**
 * A topical index's entries filed by verse, for "which topics is this verse
 * under": "b.c.v" → entry indexes. A reference to a whole chapter is filed
 * under the chapter ("b.c.0").
 */
export function topicsByVerse(entries) {
  const out = new Map();
  entries.forEach((entry, i) => {
    for (const ref of entry.refs ?? []) {
      const [book, chapter, verse, toChapter, toVerse] = ref;
      const last = toChapter === chapter ? Math.max(verse, toVerse) : verse;
      for (let v = verse; v <= Math.min(last, verse + 200); v += 1) {
        const key = `${book}.${chapter}.${v}`;
        if (!out.has(key)) out.set(key, new Set());
        out.get(key).add(i);
      }
    }
  });
  return out;
}

/** A term as it is looked up: case and accents set aside. */
export const termKey = (term) => String(term ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A kept reference as the reading's own reference ({ book, chapter, verse,
 * endBook, endChapter, endVerse }), which a link, a peek and "open" take.
 * Verse 0 is the whole chapter.
 */
export function refOf([book, chapter, verse, toChapter = chapter, toVerse = verse]) {
  return { book, chapter, verse, endBook: book, endChapter: toChapter, endVerse: toVerse };
}

/**
 * A kept reference written out, with the caller's book name and digits:
 * "Gen 1:1", "Gen 1:1–3", "Gen 1:31–2:3", "Gen 2".
 */
export function refText([book, chapter, verse, toChapter = chapter, toVerse = verse], name, digits = String) {
  const n = digits;
  if (!verse) return `${name} ${n(chapter)}`;
  const start = `${name} ${n(chapter)}:${n(verse)}`;
  if (toChapter === chapter && toVerse === verse) return start;
  return toChapter === chapter ? `${start}–${n(toVerse)}` : `${start}–${n(toChapter)}:${n(toVerse)}`;
}
