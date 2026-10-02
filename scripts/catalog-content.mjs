#!/usr/bin/env node
/**
 * What each translation in the catalog carries, written into the catalog's
 * book.json as the entry's `content` (core/content.js): books of each
 * testament, verses, words with Strong's numbers, verses with
 * cross-references, section headings and verse titles. The Library shows
 * them before a translation is downloaded, so a reader can tell a study
 * Bible from a plain one without fetching either.
 *
 * Each translation file is read the way the app reads it
 * (core/translation.js). A file with faults the app reads past (a book
 * outside the canon, names out of line with the books, a book that is a copy
 * of another, a verse without text, a join over verses given on their own)
 * gets its figures and, as `content.faults`, a count of each fault, which the
 * Library shows before the translation is downloaded. A file the app would
 * refuse outright is listed at the end
 * with why, its entry left without figures, and the run exits with status 1:
 * the app cannot install that translation either, which is worth knowing
 * apart from this. Only `content` and, when any
 * entry's figures changed, `updated` are written — the app takes a later
 * `updated` at the same `version` as a newer catalog, and fetches it again.
 * Everything else in book.json is kept as it is, in the order it is in.
 *
 *   node scripts/catalog-content.mjs <catalog repository>           what would change
 *   node scripts/catalog-content.mjs <catalog repository> --apply   write book.json
 *
 * Standard library only. The repository is the laisiangtho/bible checkout:
 * its book.json and json/<identify>.json, read against this app's own
 * public/category.json.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCategory } from '../app/core/category.js';
import { contentOf, CONTENT_KEYS } from '../app/core/content.js';
import { parseCatalog } from '../app/core/catalog.js';
import { parseTranslation } from '../app/core/translation.js';

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [repo] = args.filter((arg) => !arg.startsWith('--'));
  if (!repo) {
    console.error('usage: node scripts/catalog-content.mjs <catalog repository> [--apply]');
    process.exit(2);
  }
  const bookPath = join(repo, 'book.json');
  const text = readFileSync(bookPath, 'utf8');
  const raw = JSON.parse(text);
  // Checked the way the app checks it before anything is changed.
  parseCatalog(raw, { source: 'book.json', requireRemoteShape: true });
  // The app's own canon (public/category.json), as the app reads the files with it.
  const category = parseCategory(JSON.parse(readFileSync(new URL('../public/category.json', import.meta.url), 'utf8')));

  let changed = 0;
  const refused = [];
  const started = Date.now();
  for (const entry of raw.book) {
    const file = join(repo, 'json', `${entry.identify}.json`);
    let parsed;
    try {
      parsed = parseTranslation(JSON.parse(readFileSync(file, 'utf8')), { identify: entry.identify, category });
    } catch (err) {
      refused.push(`${entry.identify}: ${err.message}`);
      console.log(`! ${entry.identify.padEnd(14)} refused`);
      continue;
    }
    const content = { ...contentOf(parsed, category) };
    const before = entry.content ?? null;
    const same = before && CONTENT_KEYS.every((key) => before[key] === content[key])
      && JSON.stringify(before.faults ?? {}) === JSON.stringify(content.faults ?? {});
    const line = `${entry.identify.padEnd(14)} OT ${String(content.ot).padStart(2)} NT ${String(content.nt).padStart(2)}  ${String(content.verses).padStart(5)} verses`
      + `  strongs ${content.strongs}  refs ${content.refs}  headings ${content.headings}  titles ${content.titles}`;
    console.log(`${same ? ' ' : '*'} ${line}`);
    for (const [kind, n] of Object.entries(content.faults ?? {})) console.log(`      fault: ${kind} × ${n}`);
    if (!same) {
      entry.content = content;
      changed += 1;
    }
  }
  if (changed) raw.updated = new Date().toISOString();
  if (refused.length) {
    console.log(`\n${refused.length} translation file(s) the app would refuse, left without figures:`);
    for (const line of refused) console.log(`  ${line}`);
    process.exitCode = 1;
  }
  console.log(`${raw.book.length} translations read in ${((Date.now() - started) / 1000).toFixed(1)} s; ${changed} with new figures (marked *)`);
  if (!changed) { console.log('nothing to write'); return; }
  // book.json's own indentation, so the change is the figures and nothing else.
  const indent = /^\{\n(\s+)"/.exec(text)?.[1] ?? '  ';
  const out = `${JSON.stringify(raw, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
  if (!apply) { console.log('dry run: book.json not written (add --apply)'); return; }
  writeFileSync(bookPath, out);
  console.log(`written: ${bookPath} (updated ${raw.updated})`);
}

main();
