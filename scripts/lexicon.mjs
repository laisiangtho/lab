#!/usr/bin/env node
/**
 * The two lexicons the app fetches — `lexicon/strongs-h.json` and
 * `lexicon/strongs-g.json` in the catalog repository (config.lexiconUrl) —
 * built from one of two sources:
 *
 *   --source strongs  (the default)
 *       Strong's own dictionaries — Hebrew 1894, Greek 1890, public domain —
 *       in Open Scriptures' JSON edition (github.com/openscriptures/strongs:
 *       hebrew/strongs-hebrew-dictionary.js, greek/strongs-greek-dictionary.js),
 *       CC BY-SA. Free to host with credit, which the files carry. Plain
 *       Strong's numbers only: H1–H8674, G1–G5624.
 *
 *   --source step
 *       STEPBible's brief lexicons of extended Strong's numbers, TBESH and
 *       TBESG (github.com/STEPBible/STEPBible-Data), CC BY 4.0: sense letters
 *       (H1254A), modern glosses. STEPBible asks that the data not be
 *       redistributed but fetched from its own repository, and TBESH's
 *       meanings come from Online Bible's Abridged BDB, whose owner's
 *       permission STEPBible says should be sought. Written for a reader's
 *       own use, not for hosting.
 *
 * Either way the result goes through the parser the app fetches with
 * (app/core/lexicon.js, parseLexicon) before anything is written, so what this
 * writes is what the app reads. The credit, the licence and what was changed
 * are in each file's `source`, `licence` and `changes`.
 *
 *   node scripts/lexicon.mjs <hebrew> <greek> [--source strongs|step]                what would be written
 *   node scripts/lexicon.mjs <hebrew> <greek> [--source strongs|step] --out DIR --apply  write DIR/strongs-{h,g}.json
 *
 * --out is required with --apply: the files belong in the catalog
 * repository, not in this one. Standard library only.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LEXICON_SCHEMA, parseLexicon, readStepLexicon } from '../app/core/lexicon.js';

const args = process.argv.slice(2);
const valueOf = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : null; };
const apply = args.includes('--apply');
const out = valueOf('--out');
const sourceKind = valueOf('--source') ?? 'strongs';
const flagValues = new Set(['--out', '--source'].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
const files = args.filter((arg, i) => !arg.startsWith('--') && !flagValues.has(i));

const usage = 'usage: node scripts/lexicon.mjs <hebrew> <greek> [--source strongs|step] [--out DIR --apply]';
if (files.length !== 2) { console.error(usage); process.exit(2); }
if (!['strongs', 'step'].includes(sourceKind)) { console.error(`lexicon: --source is strongs or step, not ${sourceKind}`); process.exit(2); }
if (apply && !out) { console.error('lexicon: --apply needs --out DIR (the catalog repository\'s lexicon/ folder)'); process.exit(2); }



/**
 * Open Scriptures' JSON edition of Strong's: a script assigning one object,
 * `{"H1": { lemma, xlit, pron, derivation, strongs_def, kjv_def }, …}`.
 */
function fromStrongs(path, testament) {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf('{', text.indexOf('='));
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`lexicon: ${basename(path)}: no dictionary object in it — is this strongs-${testament === 'H' ? 'hebrew' : 'greek'}-dictionary.js?`);
  let raw;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch (err) {
    throw new Error(`lexicon: ${basename(path)}: the dictionary is not JSON (${err.message})`);
  }
  const entry = {};
  for (const [code, value] of Object.entries(raw)) {
    const found = /^([HG])0*(\d{1,5})$/.exec(code);
    if (!found) continue;
    if (found[1] !== testament) throw new Error(`lexicon: ${basename(path)}: ${code} in the ${testament} dictionary — the files are the wrong way round?`);
    // Strong's marks a word's own sense in braces in a few Aramaic entries
    // ("{father}"); the braces are typesetting, not meaning.
    let define = tidy(value.strongs_def).replace(/^\{(.*)\}$/, '$1');
    let derivation = tidy(value.derivation);
    // The XML edition cut Strong's sentence at its first semicolon, which in
    // a few Greek entries left the start of the definition in the
    // derivation: θεός was "figuratively, a magistrate", its "a deity …
    // the supreme Divinity" filed as etymology. What follows the first
    // semicolon is moved back unless it is itself etymology. In Hebrew that
    // text is a name's meaning ("father of God"), and stays.
    if (testament === 'G') {
      const at = derivation.indexOf(';');
      const spill = at >= 0 ? derivation.slice(at + 1).trim() : '';
      if (spill && !ETYMOLOGY.test(spill)) {
        define = [spill, define].filter(Boolean).join(' ');
        derivation = derivation.slice(0, at + 1);
      }
    }
    entry[found[2]] = drop({
      lemma: tidy(value.lemma),
      translit: tidy(value.xlit ?? value.translit),
      pronounce: tidy(value.pron),
      gloss: glossFrom(define),
      define: [define, derivation].filter(Boolean).join('\n'),
      kjv: tidy(value.kjv_def).replace(/^:?--/, '').replace(/\.$/, ''),
    });
  }
  const name = testament === 'H'
    ? 'Strong’s Hebrew Dictionary (1894)'
    : 'Strong’s Greek Dictionary (1890)';
  return finish(testament, entry, {
    name,
    source: `${name}, James Strong — public domain. JSON edition © Open Scriptures (github.com/openscriptures/strongs), CC BY-SA`,
    licence: 'CC BY-SA — https://creativecommons.org/licenses/by-sa/4.0/ (the text itself is public domain)',
    changes: 'Reshaped to this app\'s lexicon JSON: keys without the letter or leading zeros, the derivation as the definition\'s second line, typesetting braces removed, a short gloss taken from the start of the definition; in 27 Greek entries the start of the definition, filed with the derivation in the XML edition, put back.',
  }, path);
}

/** STEPBible TBESH / TBESG, read as the app reads them when a reader imports one. */
function fromStep(path, testament) {
  const read = readStepLexicon(readFileSync(path, 'utf8'), { source: basename(path) });
  if (read.testament !== testament) throw new Error(`lexicon: ${basename(path)} is the ${read.testament} lexicon, expected ${testament} — the files are the wrong way round?`);
  const entry = {};
  for (const [key, value] of Object.entries(read.entries)) entry[key] = drop(value);
  return finish(testament, entry, {
    name: read.name,
    source: `${read.name} — STEPBible.org (Tyndale House, Cambridge), https://github.com/STEPBible/STEPBible-Data`,
    licence: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
    changes: 'Converted from the tab-separated text to this JSON shape; the meaning\'s HTML reduced to text with its line breaks; where a number has several entries, the plain one kept.',
  }, path);
}

function finish(testament, entry, about, path) {
  const sorted = Object.fromEntries(Object.keys(entry).filter((key) => entry[key].define || entry[key].kjv).sort(byKey).map((key) => [key, entry[key]]));
  const file = { app: 'lai-siangtho', kind: 'lexicon', schema: LEXICON_SCHEMA, testament, ...about, entry: sorted };
  const parsed = parseLexicon(JSON.parse(JSON.stringify(file)), { source: basename(path) });
  if (Object.keys(parsed.entries).length !== Object.keys(sorted).length) {
    throw new Error(`lexicon: ${basename(path)}: the app reads ${Object.keys(parsed.entries).length} entries of ${Object.keys(sorted).length}`);
  }
  return file;
}


/** Where text after a derivation's first semicolon is still about where the word came from. */
const ETYMOLOGY = /^(?:a |an |the )?(?:prolonged|reduplicated|primary|strengthened|form|from|of |compare|probably|perhaps|apparently|middle voice|by|or )/i;

/**
 * A word or two for the interlinear line: the definition's first clause,
 * without Strong's qualifiers in brackets — "(absolutely) to create; …" is
 * "to create".
 */
function glossFrom(define) {
  let first = define.replace(/^\([^)]*\)\s*/, '').replace(/^(?:properly|literally|apparently|probably),\s*/i, '').split(/[;:]|,\s(?:i\.e\.|by implication|specially|especially|properly)/)[0];
  // Bracketed qualifiers go — "to love (in a social or moral sense)" is "to love".
  first = first.replace(/\s*\([^()]*\)/g, '').replace(/\s*\([^)]*$/, '');
  // Still a phrase, not a gloss: its first item — "Jehovah, Jewish national
  // name of God" is "Jehovah", "the first, in place, time …" is "the first".
  if (first.length > 24) first = first.split(/,\s/)[0];
  return first.replace(/["“”]/g, '').replace(/[\s,.]+$/, '').trim();
}

function tidy(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }

/** Empty fields left out: every field but the definition is optional. */
function drop(entry) { return Object.fromEntries(Object.entries(entry).filter(([, value]) => value)); }

/** 1, 1a, 1b, 2 … — by number, then sense letter. */
function byKey(a, b) {
  const [, x, xs = ''] = /^(\d+)([a-z]?)$/.exec(a) ?? [null, a];
  const [, y, ys = ''] = /^(\d+)([a-z]?)$/.exec(b) ?? [null, b];
  return Number(x) - Number(y) || xs.localeCompare(ys);
}

function main() {
  const [hebrewPath, greekPath] = files;
  const built = {
    H: sourceKind === 'step' ? fromStep(hebrewPath, 'H') : fromStrongs(hebrewPath, 'H'),
    G: sourceKind === 'step' ? fromStep(greekPath, 'G') : fromStrongs(greekPath, 'G'),
  };

  for (const testament of ['H', 'G']) {
    const file = built[testament];
    const body = `${JSON.stringify(file)}\n`;
    const name = `strongs-${testament.toLowerCase()}.json`;
    console.log(`${name}: ${Object.keys(file.entry).length} entries, ${(body.length / 1024 / 1024).toFixed(1)} MB (${(gzipSync(body).length / 1024).toFixed(0)} KB gzipped) — ${file.name}`);
    for (const sample of testament === 'H' ? ['430', '1254', '7225'] : ['26', '2316', '3056']) {
      const e = file.entry[sample] ?? file.entry[`${sample}a`];
      console.log(`  ${testament}${sample}: ${e ? `${e.lemma ?? ''} · ${e.translit ?? ''} · ${e.define.split('\n')[0].slice(0, 70)}` : '(none)'}`);
    }
    if (apply) {
      mkdirSync(resolve(out), { recursive: true });
      writeFileSync(join(resolve(out), name), body);
      console.log(`  written to ${join(out, name)}`);
    }
  }
  if (!apply) console.log('dry run: nothing written (add --out DIR --apply)');
}

main();
