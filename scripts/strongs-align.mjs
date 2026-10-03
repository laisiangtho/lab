#!/usr/bin/env node
/**
 * Strong's overlay for a translation that has none: strongs/{identify}.json
 * (the layout is in app/core/overlay.js).
 *
 * Each verse is set beside the same verse of a tagged original and each word
 * is given the number of the word it renders, by word alignment:
 *
 *   1. IBM Model 1 is trained in both directions over every verse pair
 *      (translation word given lemma, and lemma given translation word).
 *   2. A word and a lemma in the same verse are a candidate when they are
 *      found together in at least MIN_TOGETHER verses and the product of the
 *      two probabilities reaches LINK. A word may borrow the evidence of a
 *      frequent shorter word it starts with ("lumsak" from "lum"), discounted.
 *      A word the model often leaves unexplained needs SURE instead.
 *   3. Candidates are taken best first, one word to one lemma; a word left
 *      over may then share a lemma already taken when its score reaches SHARE.
 *
 * What comes out, per word:
 *   a Strong's number   the alignment is confident
 *   H9999 / G9999       a particle the original has no word for (PARTICLES)
 *   null                no confident alignment; the word stays untagged
 *
 * A wrong number is worse than none, so the thresholds favour precision. The
 * result is a draft: `info.review` is true until a reader of the language has
 * been through it. --gold measures it against verses aligned by hand.
 *
 * Sources, neither fetched here:
 *   --hebrew DIR   Open Scriptures Hebrew Bible, wlc/*.xml (CC BY 4.0),
 *                  https://github.com/openscriptures/morphhb
 *   --greek DIR    Tischendorf 8th edition with Strong's numbers,
 *                  word-per-line/2.8/Unicode/*.txt (public domain),
 *                  https://github.com/morphgnt/tischendorf-data
 *
 *   node scripts/strongs-align.mjs <identify> --hebrew DIR --greek DIR
 *        [--file PATH] [--gold PATH] [--out DIR] [--version N] [--apply]
 *
 * Dry-run by default; --apply writes <out>/strongs/{identify}.json and
 * <out>/strongs/index.json. Node standard library only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { defaults } from '../app/config.js';
import { applyStrongs, verseHash, wordsOf } from '../app/core/overlay.js';
import { plainText } from '../app/core/strongs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ITERATIONS = 8;
const SMOOTHING = 0.01;
const MIN_TOGETHER = 2;
const LINK = 5e-4;
const SHARE = 5e-3;
// A word the model often leaves unexplained (a connective, a demonstrative)
// is given a number only on strong evidence.
const OFTEN_UNEXPLAINED = Number(process.env.OFTEN ?? 0.005);
const SURE = Number(process.env.SURE ?? 2e-2);
const PREFIX_DISCOUNT = 0.3;
const PREFIX_FREQUENT = 20;

// Words of the translation with nothing behind them in the original, by
// language. Tedim: person and direction markers, the ergative, the sentence
// final, the plural and the future. A language not listed has none, and its
// particles are left untagged rather than marked.
const PARTICLES = {
  ctd: 'a hi in uh ding na ka hong nong i un hen pah aw',
};
// Lemmas no translation word answers to: the Hebrew object marker and the
// Greek article.
const UNRENDERED = new Set(['H853', 'G3588']);

const HEBREW = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal'.split(' ');
const GREEK = 'MT MR LU JOH AC RO 1CO 2CO GA EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JO 2JO 3JO JUDE RE'.split(' ');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, hebrew: { type: 'string' }, greek: { type: 'string' }, gold: { type: 'string' },
    out: { type: 'string', default: '.' }, version: { type: 'string', default: '1' }, apply: { type: 'boolean', default: false },
  },
});
const identify = positionals[0];
if (!identify || positionals.length > 1 || !values.hebrew || !values.greek) {
  console.error('usage: node scripts/strongs-align.mjs <identify> --hebrew DIR --greek DIR [--file PATH] [--gold PATH] [--out DIR] [--version N] [--apply]');
  process.exit(2);
}
const version = Number(values.version);
if (!Number.isInteger(version) || version < 1) throw new Error(`--version: expected a positive integer, got ${values.version}`);

const raw = values.file ? readJson(resolve(values.file)) : await fetchJson(defaults.translationUrl.replace('{identify}', identify));
if (raw?.info?.identify !== identify) throw new Error(`translation: expected identify ${identify}, file declares ${raw?.info?.identify}`);
const language = raw.info.language?.name;
const particles = new Set((PARTICLES[language] ?? '').split(' ').filter(Boolean));
if (!particles.size) console.error(`note: no particle list for language "${language}"; no word will be marked 9999`);

// ---------------------------------------------------------------- sources

/** verse key "book.chapter.verse" (the English numbering) → lemmas in order */
const source = new Map();
const addLemma = (book, chapter, verse, lemma) => {
  const key = `${book}.${chapter}.${verse}`;
  if (!source.has(key)) source.set(key, []);
  source.get(key).push(lemma);
};
HEBREW.forEach((name, index) => {
  const xml = readText(join(values.hebrew, `${name}.xml`));
  let verses = 0;
  for (const found of xml.matchAll(/<verse osisID="[^."]+\.(\d+)\.(\d+)">([\s\S]*?)<\/verse>/g)) {
    verses += 1;
    // Where the Hebrew numbering differs, a note gives the English verse the
    // words after it belong to.
    let chapter = Number(found[1]);
    let verse = Number(found[2]);
    for (const item of found[3].matchAll(/<note>KJV:[^.]+\.(\d+)\.(\d+)<\/note>|<w lemma="([^"]+)"/g)) {
      if (item[1]) { chapter = Number(item[1]); verse = Number(item[2]); continue; }
      // "b/7225", "1254 a", "c/853": the number is the last one; the letter is
      // Open Scriptures' own sense mark, not Strong's.
      const number = /(\d+)(?: [a-z])?$/.exec(item[3].trim());
      if (number) addLemma(index + 1, chapter, verse, `H${Number(number[1])}`);
    }
  }
  if (!verses) throw new Error(`${name}.xml: no verses found`);
});
GREEK.forEach((name, index) => {
  let words = 0;
  for (const line of readText(join(values.greek, `${name}.txt`)).split('\n')) {
    if (!line.trim()) continue;
    // "MT 1:1.1 C Βίβλος Βίβλος N-NSF 976 βίβλος ! βίβλος"
    const fields = line.split(' ');
    const at = /^(\d+):(\d+)\.\d+$/.exec(fields[1] ?? '');
    const bang = fields.indexOf('!');
    if (!at || bang < 8) throw new Error(`${name}.txt: unreadable line "${line}"`);
    for (const number of fields.slice(6, bang - 1).join(' ').match(/\d+/g) ?? []) addLemma(40 + index, Number(at[1]), Number(at[2]), `G${Number(number)}`);
    words += 1;
  }
  if (!words) throw new Error(`${name}.txt: no words found`);
});

// ---------------------------------------------------------------- verse pairs

/** What two spellings of one word share: case, punctuation and a case suffix set aside. */
function keyOf(word) {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}’']+$/gu, '').replace(/['’]+$/u, '')
    .toLowerCase().replaceAll("'", '’').replace(/-(ah|a|in|un|uh|te)$/u, '');
}
const wordIds = new Map([['', 0]]); const wordNames = [''];
const lemmaIds = new Map([['', 0]]); const lemmaNames = [''];
const idOf = (ids, names, name) => {
  let id = ids.get(name);
  if (id === undefined) { id = names.length; ids.set(name, id); names.push(name); }
  return id;
};

const pairs = [];
const unsourced = [];
for (const [b, book] of Object.entries(raw.book)) {
  for (const [c, chapter] of Object.entries(book.chapter)) {
    for (const [v, verse] of Object.entries(chapter.verse)) {
      const text = String(verse.text ?? '');
      const last = verse.merge ? Number(verse.merge) : Number(v);
      const lemmas = [];
      for (let n = Number(v); n <= last; n += 1) lemmas.push(...(source.get(`${b}.${c}.${n}`) ?? []));
      if (!lemmas.length) unsourced.push(`${b}.${c}.${v}`);
      const tokens = wordsOf(text);
      pairs.push({
        book: Number(b), chapter: Number(c), verse: Number(v), text, tokens,
        // -1: a token with no letter or digit in it, which is not a word
        t: tokens.map((token) => { const key = keyOf(token); return key ? idOf(wordIds, wordNames, key) : -1; }),
        s: lemmas.map((lemma) => idOf(lemmaIds, lemmaNames, lemma)),
      });
    }
  }
}
if (!pairs.length) throw new Error('translation: no verses');
console.log(`${identify}: ${pairs.length} verses, ${wordNames.length - 1} distinct words, ${lemmaNames.length - 1} lemmas`);
console.log(`verses with nothing in the original to align to: ${unsourced.length}${unsourced.length ? ` (${unsourced.slice(0, 30).join(' ')}${unsourced.length > 30 ? ' …' : ''})` : ''}`);

// ---------------------------------------------------------------- model

const SHIFT = 2 ** 20; // a pair of ids as one number: left * SHIFT + right
if (wordNames.length >= SHIFT || lemmaNames.length >= SHIFT) throw new Error('vocabulary too large for the pair key');

/** p(left | right), with an empty right word (id 0) to take what nothing explains. */
function train(left, right, rightCount) {
  let table = new Map();
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const counts = new Map();
    const totals = new Float64Array(rightCount);
    for (const pair of pairs) {
      const ls = pair[left].filter((id) => id >= 0);
      if (!ls.length || !pair[right].length) continue;
      const rs = [0, ...pair[right].filter((id) => id >= 0)];
      for (const l of ls) {
        let sum = 0;
        const each = rs.map((r) => { const p = iteration === 0 ? 1 : (table.get(l * SHIFT + r) ?? 1e-9); sum += p; return p; });
        rs.forEach((r, i) => {
          const share = each[i] / sum;
          const key = l * SHIFT + r;
          counts.set(key, (counts.get(key) ?? 0) + share);
          totals[r] += share;
        });
      }
    }
    const kinds = new Float64Array(rightCount);
    for (const key of counts.keys()) kinds[key % SHIFT] += 1;
    table = new Map();
    for (const [key, count] of counts) {
      const r = key % SHIFT;
      const p = (count + SMOOTHING) / (totals[r] + SMOOTHING * kinds[r]);
      if (p > 1e-7) table.set(key, p);
    }
  }
  return table;
}
console.log('training (two passes over every verse, a few minutes) …');
const wordGivenLemma = train('t', 's', lemmaNames.length);
const lemmaGivenWord = train('s', 't', wordNames.length);
const score = (word, lemma) => (wordGivenLemma.get(word * SHIFT + lemma) ?? 0) * (lemmaGivenWord.get(lemma * SHIFT + word) ?? 0);

const together = new Map(); // verses holding both the word and the lemma
const frequency = new Map();
for (const pair of pairs) {
  const lemmas = new Set(pair.s);
  for (const word of new Set(pair.t)) {
    if (word < 0) continue;
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
    for (const lemma of lemmas) together.set(word * SHIFT + lemma, (together.get(word * SHIFT + lemma) ?? 0) + 1);
  }
}
const seenTogether = (word, lemma) => (together.get(word * SHIFT + lemma) ?? 0) >= MIN_TOGETHER;

/** Frequent shorter words a word starts with, longest first. */
const prefixCache = new Map();
function prefixesOf(word) {
  let found = prefixCache.get(word);
  if (found) return found;
  found = [];
  const name = wordNames[word];
  for (let length = name.length - 1; length >= 3; length -= 1) {
    const id = wordIds.get(name.slice(0, length));
    if (id !== undefined && (frequency.get(id) ?? 0) >= PREFIX_FREQUENT) found.push(id);
  }
  prefixCache.set(word, found);
  return found;
}

// ---------------------------------------------------------------- alignment

const particleIds = new Set([...particles].map((name) => wordIds.get(name)).filter((id) => id !== undefined));
const unrenderedIds = new Set([...UNRENDERED].map((name) => lemmaIds.get(name)).filter((id) => id !== undefined));

/** @returns {(string|null)[]} one entry per token */
function align(pair) {
  const edition = `${pair.book <= 39 ? 'H' : 'G'}9999`;
  const out = pair.tokens.map(() => null);
  const candidates = [];
  pair.t.forEach((word, i) => {
    if (word < 0) return;
    if (particleIds.has(word)) { out[i] = edition; return; }
    pair.s.forEach((lemma, j) => {
      if (unrenderedIds.has(lemma)) return;
      let best = seenTogether(word, lemma) ? score(word, lemma) : 0;
      for (const prefix of prefixesOf(word)) if (seenTogether(prefix, lemma)) best = Math.max(best, PREFIX_DISCOUNT * score(prefix, lemma));
      const needed = (wordGivenLemma.get(word * SHIFT) ?? 0) >= OFTEN_UNEXPLAINED ? SURE : LINK;
      if (best >= needed) candidates.push([best, i, j]);
    });
  });
  candidates.sort((a, b) => b[0] - a[0]);
  const taken = new Set();
  for (const [, i, j] of candidates) {
    if (out[i] !== null || taken.has(j)) continue;
    out[i] = lemmaNames[pair.s[j]];
    taken.add(j);
  }
  for (const [value, i, j] of candidates) if (out[i] === null && value >= SHARE) out[i] = lemmaNames[pair.s[j]];
  return out;
}

const overlay = {};
const stats = { verses: 0, words: 0, tagged: 0, edition: {}, untagged: 0 };
const aligned = new Map();
for (const pair of pairs) {
  const w = align(pair);
  aligned.set(`${pair.book}.${pair.chapter}.${pair.verse}`, w);
  for (const [i, code] of w.entries()) {
    if (pair.t[i] < 0) continue;
    stats.words += 1;
    if (code === null) stats.untagged += 1;
    else if (code.endsWith('9999')) stats.edition[code] = (stats.edition[code] ?? 0) + 1;
    else stats.tagged += 1;
  }
  // A verse with no number in it adds nothing; it is left out.
  if (!w.some((code) => code !== null && !code.endsWith('9999'))) continue;
  const where = `${pair.book}.${pair.chapter}.${pair.verse}`;
  const entry = { w, of: verseHash(pair.text) };
  // The reader's own check, run here: the numbers go on and come off again
  // leaving the master's text exactly.
  if (plainText(applyStrongs(pair.text, entry, where)) !== pair.text) throw new Error(`${where}: the text does not survive its numbers`);
  (((overlay[pair.book] ??= { chapter: {} }).chapter[pair.chapter] ??= { verse: {} }).verse)[pair.verse] = entry;
  stats.verses += 1;
}

const percent = (part, whole) => `${((part / whole) * 100).toFixed(1)}%`;
console.log(`words ${stats.words}: tagged ${stats.tagged} (${percent(stats.tagged, stats.words)}), particles ${Object.values(stats.edition).reduce((a, b) => a + b, 0)}, untagged ${stats.untagged} (${percent(stats.untagged, stats.words)})`);
console.log(`verses carrying a number: ${stats.verses} of ${pairs.length}`);
for (const [label, from, to] of [['Old Testament', 1, 39], ['New Testament', 40, 66]]) {
  let words = 0; let tagged = 0;
  for (const pair of pairs) {
    if (pair.book < from || pair.book > to) continue;
    aligned.get(`${pair.book}.${pair.chapter}.${pair.verse}`).forEach((code, i) => {
      if (pair.t[i] < 0 || particleIds.has(pair.t[i])) return;
      words += 1;
      if (code !== null) tagged += 1;
    });
  }
  if (words) console.log(`  ${label}: ${percent(tagged, words)} of the words that are not particles`);
}

// ---------------------------------------------------------------- measure

if (values.gold) {
  // { "19.23.1": "H3068 F H7462 …" } — one entry per word: a number, F for a
  // word with nothing behind it, ? for a word not judged.
  const gold = readJson(resolve(values.gold));
  let right = 0; let wrong = 0; let invented = 0; let wanted = 0;
  const misses = [];
  for (const [where, line] of Object.entries(gold)) {
    const got = aligned.get(where);
    if (!got) throw new Error(`gold: no verse ${where}`);
    const want = line.split(' ');
    if (want.length !== got.length) throw new Error(`gold: ${where} has ${want.length} entries for ${got.length} words`);
    want.forEach((code, i) => {
      const number = got[i] && !got[i].endsWith('9999') ? got[i] : null;
      if (code === '?') return;
      if (code === 'F') { if (number) { invented += 1; misses.push(`${where} word ${i + 1}: ${number} on a particle`); } return; }
      wanted += 1;
      if (number === code) right += 1;
      else if (number) { wrong += 1; misses.push(`${where} word ${i + 1}: ${number}, expected ${code}`); }
    });
  }
  console.log(`gold (${Object.keys(gold).length} verses, ${wanted} judged words): of the numbers given ${percent(right, right + wrong + invented)} are right; ${percent(right, wanted)} of the words that should have one do`);
  for (const miss of misses) console.log(`  ${miss}`);
}

// ---------------------------------------------------------------- write

const file = {
  info: {
    identify, kind: 'strongs', version, review: true,
    language,
    method: 'Word alignment (IBM Model 1, both directions), scripts/strongs-align.mjs. A draft, not reviewed by a reader of the language.',
    sources: [
      'Open Scriptures Hebrew Bible (CC BY 4.0), https://github.com/openscriptures/morphhb',
      'Tischendorf 8th edition with Strong\'s numbers (public domain), https://github.com/morphgnt/tischendorf-data',
    ],
    edition: { H9999: 'a word with nothing behind it in the Hebrew', G9999: 'a word with nothing behind it in the Greek' },
    hash: 'FNV-1a, 32 bits, over the UTF-8 bytes of the verse text',
    stats,
  },
  book: overlay,
};
const outDir = resolve(values.out, 'strongs');
const outPath = join(outDir, `${identify}.json`);
const body = `${JSON.stringify(file)}\n`;
const indexPath = join(outDir, 'index.json');
const index = existsSync(indexPath) ? readJson(indexPath) : { overlays: [] };
if (!Array.isArray(index.overlays)) throw new Error(`${indexPath}: expected { overlays: [] }`);
const row = { identify, version, review: true, verses: stats.verses, words: stats.tagged, bytes: Buffer.byteLength(body) };
index.overlays = [...index.overlays.filter((item) => item.identify !== identify), row].sort((a, b) => String(a.identify).localeCompare(String(b.identify)));

if (!values.apply) {
  console.log(`dry run: would write ${outPath} (${(row.bytes / 1e6).toFixed(1)} MB) and ${indexPath}; --apply writes them`);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, body);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`wrote ${outPath} (${(row.bytes / 1e6).toFixed(1)} MB) and ${indexPath}`);
}

// ---------------------------------------------------------------- helpers

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
