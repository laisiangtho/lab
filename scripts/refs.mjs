#!/usr/bin/env node
/**
 * Cross-reference overlay for a translation that has none:
 * refs/{identify}.json (the layout is in app/core/overlay.js).
 *
 * The references are OpenBible.info's (CC BY), one row a link from a verse to
 * a verse or a passage, with the votes its readers gave it. For each verse the
 * links with at least --min-votes are taken, the --max best of them kept, and
 * written in canon order with the translation's own book abbreviations
 * ("Pau 8:22-30; Zek 12:1"), which is how a translation file writes its own.
 *
 * Every line written is read back with the app's reference parser and must
 * resolve to exactly the passages it was written from; a line that does not is
 * an error, not a line quietly left out. A link to a verse the translation
 * does not hold is dropped and counted. A verse joined to the one before it
 * (`merge`) gives its links to the verse that holds its text.
 *
 * The source, not fetched here: cross_references.txt, from
 * https://www.openbible.info/labs/cross-references/
 *
 *   node scripts/refs.mjs <identify> --source cross_references.txt
 *        [--file PATH] [--min-votes N] [--max N] [--out DIR] [--version N] [--apply]
 *
 * Dry-run by default; --apply writes <out>/refs/{identify}.json and
 * <out>/refs/index.json. Node standard library only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { defaults } from '../app/config.js';
import { parseCategory } from '../app/core/category.js';
import { createResolver, parseReferences } from '../app/core/reference.js';
import { parseTranslation } from '../app/core/translation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ');
const BOOK = new Map(OSIS.map((name, index) => [name, index + 1]));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, source: { type: 'string' }, out: { type: 'string', default: '.' },
    'min-votes': { type: 'string', default: '5' }, max: { type: 'string', default: '5' },
    version: { type: 'string', default: '1' }, apply: { type: 'boolean', default: false },
  },
});
const identify = positionals[0];
if (!identify || positionals.length > 1 || !values.source) {
  console.error('usage: node scripts/refs.mjs <identify> --source cross_references.txt [--file PATH] [--min-votes N] [--max N] [--out DIR] [--version N] [--apply]');
  process.exit(2);
}
const whole = (name) => {
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name}: expected a positive integer, got ${values[name]}`);
  return n;
};
const minVotes = whole('min-votes'); const max = whole('max'); const version = whole('version');

const category = parseCategory(readJson(resolve(ROOT, 'public/category.json')));
const raw = values.file ? readJson(resolve(values.file)) : await fetchJson(defaults.translationUrl.replace('{identify}', identify));
const { meta, chapters } = parseTranslation(raw, { identify, category });
const resolver = createResolver({ category, books: meta.books });

// Where each verse's text is: itself, or the verse it was joined to.
const holder = new Map();
for (const { book, chapter, verses } of chapters) {
  for (const [key, verse] of Object.entries(verses)) {
    for (let n = Number(key); n <= (verse.merge ?? Number(key)); n += 1) holder.set(`${book}.${chapter}.${n}`, Number(key));
  }
}
const shortname = (book) => {
  const name = meta.books[book]?.shortname;
  if (!name) throw new Error(`translation: book ${book} has no shortname`);
  return name;
};

// ---------------------------------------------------------------- source

const point = (text, line) => {
  const found = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(text);
  const book = found && BOOK.get(found[1]);
  if (!book) throw new Error(`${values.source}:${line}: unreadable verse "${text}"`);
  return { book, chapter: Number(found[2]), verse: Number(found[3]) };
};
const links = new Map(); // "book.chapter.verse" of the holder → links
const dropped = { votes: 0, from: 0, to: 0, acrossBooks: 0 };
let rows = 0;
readText(resolve(values.source)).split(/\r?\n/).forEach((line, index) => {
  if (!line.trim() || index === 0) return;
  const [fromText, toText, votesText] = line.split('\t');
  const votes = Number(votesText);
  if (!fromText || !toText || !Number.isFinite(votes)) throw new Error(`${values.source}:${index + 1}: expected "from<TAB>to<TAB>votes"`);
  rows += 1;
  if (votes < minVotes) { dropped.votes += 1; return; }
  const from = point(fromText, index + 1);
  const [startText, endText] = toText.split('-');
  const start = point(startText, index + 1);
  const end = endText ? point(endText, index + 1) : start;
  if (end.book !== start.book) { dropped.acrossBooks += 1; return; }
  const held = holder.get(`${from.book}.${from.chapter}.${from.verse}`);
  if (held === undefined) { dropped.from += 1; return; }
  if (!holder.has(`${start.book}.${start.chapter}.${start.verse}`) || !holder.has(`${end.book}.${end.chapter}.${end.verse}`)) { dropped.to += 1; return; }
  const key = `${from.book}.${from.chapter}.${held}`;
  if (!links.has(key)) links.set(key, []);
  links.get(key).push({ start, end, votes });
});
if (!rows) throw new Error(`${values.source}: no rows`);

// ---------------------------------------------------------------- write out

const order = (a, b) => a.start.book - b.start.book || a.start.chapter - b.start.chapter || a.start.verse - b.start.verse;
const written = ({ start, end }) => {
  const head = `${shortname(start.book)} ${start.chapter}:${start.verse}`;
  if (end.chapter !== start.chapter) return `${head}-${end.chapter}:${end.verse}`;
  return end.verse !== start.verse ? `${head}-${end.verse}` : head;
};
const overlay = {};
const stats = { verses: 0, references: 0 };
for (const [key, list] of links) {
  const [book, chapter, verse] = key.split('.').map(Number);
  const seen = new Set();
  const kept = list.sort((a, b) => b.votes - a.votes).filter((link) => {
    const id = written(link);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, max).sort(order);
  const ref = kept.map(written).join('; ');
  // Read back as the app will read it.
  const parts = parseReferences(ref, resolver, { digit: meta.digit });
  if (parts.length !== kept.length) throw new Error(`${key}: "${ref}" reads as ${parts.length} references, ${kept.length} were written`);
  parts.forEach((part, i) => {
    const got = part.refs?.[0];
    const { start, end } = kept[i];
    const same = got && got.book === start.book && got.chapter === start.chapter && got.verse === start.verse
      && (got.endChapter ?? got.chapter) === end.chapter && (got.endVerse ?? got.verse) === end.verse;
    if (!same) throw new Error(`${key}: "${part.text}" does not read back as written (${part.unresolved ?? JSON.stringify(got)})`);
  });
  (((overlay[book] ??= { chapter: {} }).chapter[chapter] ??= { verse: {} }).verse)[verse] = { ref };
  stats.verses += 1;
  stats.references += kept.length;
}
const sorted = Object.fromEntries(Object.keys(overlay).sort((a, b) => a - b).map((book) => [book, {
  chapter: Object.fromEntries(Object.keys(overlay[book].chapter).sort((a, b) => a - b).map((chapter) => [chapter, {
    verse: Object.fromEntries(Object.keys(overlay[book].chapter[chapter].verse).sort((a, b) => a - b).map((verse) => [verse, overlay[book].chapter[chapter].verse[verse]])),
  }])),
}]));

console.log(`${identify}: ${rows} links read; kept ${stats.references} on ${stats.verses} of ${holder.size} verses (at least ${minVotes} votes, at most ${max} a verse)`);
console.log(`dropped: ${dropped.votes} under ${minVotes} votes, ${dropped.from} from a verse the translation does not hold, ${dropped.to} to one it does not hold, ${dropped.acrossBooks} running from one book into another`);

const file = {
  info: {
    identify, kind: 'refs', version, review: false,
    method: `OpenBible.info cross-references with at least ${minVotes} votes, the ${max} best a verse, scripts/refs.mjs.`,
    sources: ['Cross-references from OpenBible.info (CC BY), https://www.openbible.info/labs/cross-references/'],
    stats,
  },
  book: sorted,
};
const outDir = resolve(values.out, 'refs');
const outPath = join(outDir, `${identify}.json`);
const body = `${JSON.stringify(file)}\n`;
const indexPath = join(outDir, 'index.json');
const index = existsSync(indexPath) ? readJson(indexPath) : { overlays: [] };
if (!Array.isArray(index.overlays)) throw new Error(`${indexPath}: expected { overlays: [] }`);
const row = { identify, version, review: false, verses: stats.verses, references: stats.references, bytes: Buffer.byteLength(body) };
index.overlays = [...index.overlays.filter((item) => item.identify !== identify), row].sort((a, b) => String(a.identify).localeCompare(String(b.identify)));
if (!values.apply) {
  console.log(`dry run: would write ${outPath} (${(row.bytes / 1e6).toFixed(1)} MB) and ${indexPath}; --apply writes them`);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, body);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${outPath} (${(row.bytes / 1e6).toFixed(1)} MB) and ${indexPath}`);
}

function readText(path) {
  if (!existsSync(path)) throw new Error(`${path}: no such file`);
  return readFileSync(path, 'utf8');
}
function readJson(path) {
  try { return JSON.parse(readText(path)); } catch (error) { throw new Error(`${path}: ${error.message}`); }
}
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
