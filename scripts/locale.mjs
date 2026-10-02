#!/usr/bin/env node
/**
 * The interface languages the app fetches (core/locale.js): Burmese, Zolai
 * and whatever comes after. Their sources are this repository's
 * `locale/<code>.json`; the catalog repository (laisiangtho/bible) publishes
 * them from its own `locale/` folder, beside an `index.json` that says what
 * is there and gives each file a fingerprint, so a device knows when its
 * copy is old.
 *
 * Each file is checked against English (app/shell/locales/en.js) the way
 * the built-in Norwegian is: every key, no others, the same placeholders,
 * plural forms as the file declares. A file that fails is named with what is
 * wrong, nothing is written, and the run exits with status 1.
 *
 *   node scripts/locale.mjs                       check, and say what would be written
 *   node scripts/locale.mjs --apply               write locale/index.json
 *   node scripts/locale.mjs --to <catalog repository> [--apply]
 *                                                 the same, and the files and
 *                                                 the index copied into its locale/
 *
 * Standard library only.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLocale, parseLocale, parseLocaleIndex } from '../app/core/locale.js';
import english from '../app/shell/locales/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOLDER = join(ROOT, 'locale');

/** What index.json must be for the files in a folder; throws on a file that is not fit to publish. */
export function buildIndex(folder = FOLDER) {
  const files = readdirSync(folder).filter((name) => name.endsWith('.json') && name !== 'index.json').sort();
  const locales = [];
  const problems = [];
  for (const name of files) {
    const code = name.slice(0, -'.json'.length);
    const bytes = readFileSync(join(folder, name));
    const locale = parseLocale(JSON.parse(bytes.toString('utf8')), code, `locale/${name}`);
    const found = auditLocale(locale, english);
    if (found.length) problems.push(`locale/${name}: ${found.length} problem(s)\n${found.slice(0, 40).map((line) => `    ${line}`).join('\n')}${found.length > 40 ? `\n    and ${found.length - 40} more` : ''}`);
    locales.push({
      code, name: locale.name, english: locale.english,
      version: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
      strings: Object.keys(locale.strings).length,
      ...(locale.review ? { review: true } : {}),
    });
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return { locales };
}

export const indexText = (index) => `${JSON.stringify(index, null, 2)}\n`;

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const toAt = args.indexOf('--to');
  const to = toAt >= 0 ? args[toAt + 1] : null;
  if (toAt >= 0 && !to) throw new Error('locale: --to needs the catalog repository\'s folder');
  const unknown = args.filter((a, i) => a !== '--apply' && a !== '--to' && i !== toAt + 1);
  if (unknown.length) throw new Error(`locale: unknown argument ${unknown.join(' ')} (--apply, --to <catalog repository>)`);
  if (to && !existsSync(join(to, 'book.json'))) throw new Error(`locale: ${to} is not the catalog repository (no book.json in it)`);

  const index = buildIndex();
  parseLocaleIndex(index);
  const text = indexText(index);
  for (const one of index.locales) {
    console.log(`${one.code.padEnd(5)} ${one.english.padEnd(16)} ${String(one.strings).padStart(5)} strings  ${one.version}${one.review ? '  to be reviewed' : ''}`);
  }
  const writes = [[join(FOLDER, 'index.json'), text]];
  if (to) {
    for (const one of index.locales) writes.push([join(to, 'locale', `${one.code}.json`), readFileSync(join(FOLDER, `${one.code}.json`), 'utf8')]);
    writes.push([join(to, 'locale', 'index.json'), text]);
  }
  let changed = 0;
  for (const [path, body] of writes) {
    const same = existsSync(path) && readFileSync(path, 'utf8') === body;
    if (!same) changed += 1;
    console.log(`${same ? 'same   ' : apply ? 'wrote  ' : 'would write'} ${path}`);
    if (!same && apply) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
  }
  if (!apply && changed) console.log('\nDry run. Re-run with --apply to write.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
