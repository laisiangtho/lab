#!/usr/bin/env node
/**
 * Check a guide folder the way the app will read it.
 *
 *   node scripts/guide-check.mjs <path to the catalog repository's guide/>
 *
 * Every file that is not Markdown is read as a schema.org FAQPage by the
 * app's own parser (app/core/guidedata.js), so what passes here is what the
 * guide will accept. Each problem is named with its file and question; the
 * exit status is 1 when there is any, so this can run in the catalog
 * repository's CI. Nothing is written.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { guidePaths, parseGuideFile, strayPaths } from '../app/core/guidedata.js';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/guide-check.mjs <path to guide/>'); process.exit(2); }
let stat;
try { stat = statSync(dir); } catch { console.error(`guide-check: ${dir} does not exist`); process.exit(2); }
if (!stat.isDirectory()) { console.error(`guide-check: ${dir} is not a folder`); process.exit(2); }

// Paths as the repository names them: guide/<lang>/...
const files = walk(dir).map((path) => ({ path, repo: `guide/${relative(dir, path).split(sep).join('/')}` }));
const repoPaths = files.map((f) => f.repo);
const data = new Set(guidePaths(repoPaths));
let problems = 0;
const counts = new Map();

for (const stray of strayPaths(repoPaths)) {
  problems += 1;
  console.log(`✗ ${stray}: not guide data — data is guide/<language>/…/<topic>.json, and Markdown is for people`);
}
for (const file of files.filter((f) => data.has(f.repo))) {
  try {
    let json;
    try { json = JSON.parse(readFileSync(file.path, 'utf8')); } catch (err) { throw new Error(`${file.repo}: not valid JSON (${err.message})`); }
    const parsed = parseGuideFile(json, file.repo);
    const key = parsed.lang;
    const held = counts.get(key) ?? { topics: 0, questions: 0 };
    counts.set(key, { topics: held.topics + 1, questions: held.questions + parsed.entries.length });
  } catch (err) {
    problems += 1;
    console.log(`✗ ${err.message}`);
  }
}
for (const [lang, { topics, questions }] of [...counts].sort()) console.log(`✓ ${lang}: ${topics} topics, ${questions} questions`);
if (problems) { console.log(`\n${problems} problem${problems === 1 ? '' : 's'}.`); process.exit(1); }
console.log('\nEvery file reads.');
