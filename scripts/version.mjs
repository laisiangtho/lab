#!/usr/bin/env node
/**
 * Version stamping: the app's version is a date plus a build number for that
 * day — 26.09.23.5 means the fifth build on 23 September 2026.
 *
 * npm and electron-builder need semver, which has three parts, so the date is
 * the semver version (26.9.23) and the build number goes in electron-builder's
 * `buildVersion` and `buildNumber` (the package revision of a .deb or .rpm).
 * app/version.js carries the full string the app displays.
 *
 *   node scripts/version.mjs            # report the current version
 *   node scripts/version.mjs --apply    # stamp today's date, next build number
 *   node scripts/version.mjs --apply --build 3
 *
 * Node standard library only.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  version: resolve(ROOT, 'app/version.js'),
  pkg: resolve(ROOT, 'package.json'),
  builder: resolve(ROOT, 'electron-builder.yml'),
};

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false }, build: { type: 'string' } } });

const current = /VERSION = '([\d.]+)'/.exec(readFileSync(files.version, 'utf8'))?.[1] ?? '';
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const today = `${pad(now.getFullYear() % 100)}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;

let build = Number(values.build ?? NaN);
if (!Number.isInteger(build) || build < 1) {
  const [y, m, d, n] = current.split('.');
  build = `${y}.${m}.${d}` === today ? Number(n) + 1 : 1;
}
const next = `${today}.${build}`;
const semver = today.split('.').map(Number).join('.'); // 26.09.23 → 26.9.23

if (!values.apply) {
  console.log(`current ${current}\nnext    ${next}  (semver ${semver}, buildVersion and buildNumber ${build})\n\nDry run. Re-run with --apply to stamp.`);
  process.exit(0);
}

// Checked before anything is written, so a failure leaves all three files as
// they were.
let builder = readFileSync(files.builder, 'utf8');
for (const key of ['buildVersion', 'buildNumber']) {
  const line = new RegExp(`^${key}: .*$`, 'm');
  if (!line.test(builder)) {
    console.error(`electron-builder.yml has no top-level ${key} line; nothing was stamped`);
    process.exit(1);
  }
  builder = builder.replace(line, `${key}: "${build}"`);
}

writeFileSync(files.version, `/**
 * Version, stamped by scripts/version.mjs. Do not edit by hand.
 *
 * VERSION is yy.mm.dd.build — the date of the build and its number that day.
 */

export const VERSION = '${next}';
export const BUILT_AT = '${now.toISOString()}';
`);

const pkg = JSON.parse(readFileSync(files.pkg, 'utf8'));
pkg.version = semver;
writeFileSync(files.pkg, `${JSON.stringify(pkg, null, 2)}\n`);

writeFileSync(files.builder, builder);

console.log(`stamped ${next} (package.json ${semver}, buildVersion and buildNumber ${build})`);
