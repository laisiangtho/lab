#!/usr/bin/env node
/**
 * Release plan: what a release commit asks for, and the version it releases.
 *
 * The release workflow runs this first. A commit whose message starts with
 * `release:web`, `release:desktop` or `release:all` names its targets; the
 * version is whatever scripts/version.mjs last stamped. Nothing here changes a
 * file — it reads, checks and reports, so running it locally before pushing
 * shows exactly what the workflow will do.
 *
 *   node scripts/release-plan.mjs "release:all fix the chapter picker"
 *   node scripts/release-plan.mjs --target desktop
 *
 * The three stamped files must agree (app/version.js, package.json,
 * electron-builder.yml): an installer carries package.json's version and
 * buildVersion, the update check compares against app/version.js, and a
 * release made from files that disagree is a release that reports itself
 * wrongly. A disagreement is an error naming both values.
 *
 * Under GitHub Actions the plan is also written to $GITHUB_OUTPUT as
 * `web`, `desktop`, `version` and `tag`.
 *
 * Node standard library only.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['web', 'desktop', 'all'];

/**
 * The target a commit message asks for. Only the first line counts, and the
 * word must end there or at a space or colon, so `release:webby` is refused
 * rather than read as `release:web`.
 */
export function targetFromMessage(message) {
  const first = String(message ?? '').split(/\r?\n/, 1)[0].trim();
  if (!first.startsWith('release:')) {
    throw new Error(`not a release commit: "${first}" (expected release:${TARGETS.join(' | release:')})`);
  }
  const m = /^release:([a-z]+)(?=$|[\s:])/.exec(first);
  if (!m || !TARGETS.includes(m[1])) {
    throw new Error(`unknown release target in "${first}" (expected release:${TARGETS.join(' | release:')})`);
  }
  return m[1];
}

/** The stamped version, checked for agreement across the three files. */
export function stampedVersion(root = ROOT) {
  const source = readFileSync(resolve(root, 'app/version.js'), 'utf8');
  const version = /VERSION = '(\d{2}\.\d{2}\.\d{2}\.\d+)'/.exec(source)?.[1];
  if (!version) throw new Error('app/version.js: no VERSION in the yy.mm.dd.build form');

  const [y, mo, d, build] = version.split('.');
  const semver = [y, mo, d].map(Number).join('.');

  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  if (pkg !== semver) {
    throw new Error(`package.json version is ${pkg} but app/version.js is ${version} (expected ${semver}); run scripts/version.mjs --apply`);
  }

  const builder = /^buildVersion:\s*"?(\d+)"?\s*$/m.exec(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'))?.[1];
  if (builder !== String(Number(build))) {
    throw new Error(`electron-builder.yml buildVersion is ${builder ?? 'missing'} but app/version.js is ${version} (expected ${Number(build)}); run scripts/version.mjs --apply`);
  }
  return version;
}

export function plan({ target, root = ROOT }) {
  if (!TARGETS.includes(target)) throw new Error(`unknown release target "${target}" (expected ${TARGETS.join(', ')})`);
  const version = stampedVersion(root);
  return {
    web: target === 'web' || target === 'all',
    desktop: target === 'desktop' || target === 'all',
    version,
    tag: `v${version}`,
  };
}

function main() {
  const { values, positionals } = parseArgs({
    options: { target: { type: 'string' } },
    allowPositionals: true,
  });
  const message = positionals.join(' ') || process.env.RELEASE_MESSAGE;
  const target = values.target ?? targetFromMessage(message);
  const result = plan({ target });

  for (const [key, value] of Object.entries(result)) console.log(`${key.padEnd(8)}${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k, v]) => `${k}=${v}\n`).join(''));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`release plan: ${error.message}`);
    process.exit(1);
  }
}
