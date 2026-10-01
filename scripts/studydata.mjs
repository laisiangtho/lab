#!/usr/bin/env node
/**
 * Study data for the catalog repository's study/ folder, where a web page can
 * download it: a publisher's file read the way the app reads it
 * (core/studydata.js) and written as the app's own JSON, its source and
 * licence kept and the change stated, as CC BY asks.
 *
 * The publishers' own sites seldom let a web page read from them, so the
 * Library's "Get" on the web uses these copies; the desktop app still goes
 * to the publisher first.
 *
 *   node scripts/studydata.mjs <file> --id <id> [--type dictionary|topics] [--out DIR] [--apply]
 *
 *   <file>   cross_references.txt (OpenBible.info, from cross-references.zip),
 *            ebd2.xml (Easton's, CCEL), bible.xml (Nave's, CCEL)
 *   --id     the name the app asks for: openbible, easton or nave
 *   --type   how a ThML work is read; Easton's is a dictionary, Nave's topics
 *   --out    the catalog repository (study/<id>.json is written under it);
 *            without it, nothing is written
 *   --apply  write; without it, a dry run that reads, checks and reports
 *
 * Standard library only. A file that is not study data, an unknown id, or a
 * type that does not fit the file is an error.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStudyFile, toStudyJson } from '../app/core/studydata.js';

const KNOWN = { openbible: 'crossrefs', easton: 'dictionary', nave: 'topics' };

function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const at = args.indexOf(flag);
    if (at < 0) return null;
    const next = args[at + 1];
    if (!next || next.startsWith('--')) throw new Error(`${flag} needs a value`);
    return next;
  };
  const id = value('--id');
  const type = value('--type');
  const out = value('--out');
  const apply = args.includes('--apply');
  const flagged = new Set(['--id', '--type', '--out'].flatMap((flag) => {
    const at = args.indexOf(flag);
    return at < 0 ? [] : [at, at + 1];
  }));
  const [path] = args.filter((arg, i) => !arg.startsWith('--') && !flagged.has(i));
  if (!path || !id) {
    console.error('usage: node scripts/studydata.mjs <file> --id <openbible|easton|nave> [--type dictionary|topics] [--out DIR] [--apply]');
    process.exit(2);
  }
  if (!KNOWN[id]) throw new Error(`--id ${id}: the app asks for ${Object.keys(KNOWN).join(', ')}`);
  const wanted = type ?? KNOWN[id];
  if (wanted !== KNOWN[id]) throw new Error(`--type ${wanted}: the app reads ${id} as ${KNOWN[id]}`);

  const started = Date.now();
  const read = readStudyFile(readFileSync(path, 'utf8').replace(/^﻿/, ''), { source: path, type: wanted });
  const json = toStudyJson(read, { changes: `Read from the publisher's file by scripts/studydata.mjs and written as this app's study data (${read.format} → JSON).` });
  const body = JSON.stringify(json);
  // What is written is what the app will read: read it back the same way.
  const again = readStudyFile(body, { source: `study/${id}.json`, type: wanted });
  if (again.count !== read.count) throw new Error(`read back ${again.count} entries, wrote ${read.count}`);

  console.log(`${path}: ${read.format}, ${read.type}, "${read.name}"`);
  console.log(`  ${read.count} ${read.type === 'crossrefs' ? 'links' : 'entries'}${read.outside ? `, ${read.outside} outside the canon left out` : ''}`);
  console.log(`  source:  ${read.source}`);
  console.log(`  licence: ${read.licence || '(none stated)'}`);
  console.log(`  study/${id}.json: ${(body.length / 1024).toFixed(0)} KB (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (!apply || !out) {
    console.log(`dry run: nothing written${out ? ' (add --apply)' : ' (add --out DIR --apply)'}`);
    return;
  }
  mkdirSync(join(out, 'study'), { recursive: true });
  writeFileSync(join(out, 'study', `${id}.json`), body);
  console.log(`written: ${join(out, 'study', `${id}.json`)}`);
}

main();
