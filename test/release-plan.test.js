/**
 * The release plan: which commit messages release what, and that a version
 * stamped in one file but not the others is refused.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { plan, stampedVersion, targetFromMessage } from '../scripts/release-plan.mjs';
import { root } from './helpers.js';

test('release target is read from the first line of the message', () => {
  assert.equal(targetFromMessage('release:web'), 'web');
  assert.equal(targetFromMessage('release:desktop fix the picker'), 'desktop');
  assert.equal(targetFromMessage('release:all: 26.09.29.9\n\nlonger body'), 'all');
  assert.equal(targetFromMessage('  release:web  \nrelease:desktop'), 'web');
});

test('anything else is refused with the reason', () => {
  assert.throws(() => targetFromMessage('fix: release:web later'), /not a release commit/);
  assert.throws(() => targetFromMessage('feat: body\nrelease:web'), /not a release commit/);
  assert.throws(() => targetFromMessage('release:webby'), /unknown release target/);
  assert.throws(() => targetFromMessage('release:mobile'), /unknown release target/);
  assert.throws(() => targetFromMessage('release:'), /unknown release target/);
  assert.throws(() => targetFromMessage(undefined), /not a release commit/);
});

test('the plan names its targets and the tag the update check will read', () => {
  const version = stampedVersion();
  assert.deepEqual(plan({ target: 'web' }), { web: true, desktop: false, version, tag: `v${version}` });
  assert.deepEqual(plan({ target: 'desktop' }), { web: false, desktop: true, version, tag: `v${version}` });
  assert.deepEqual(plan({ target: 'all' }), { web: true, desktop: true, version, tag: `v${version}` });
  assert.throws(() => plan({ target: 'mobile' }), /unknown release target/);
});

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'release-plan-'));
  for (const f of ['app/version.js', 'package.json', 'electron-builder.yml']) {
    cpSync(root(f), join(dir, f), { recursive: true });
  }
  return dir;
}

test('a stamp the three files disagree about is refused', () => {
  const pkgDir = copy();
  const pkgPath = join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: '1.2.3' }));
  assert.throws(() => stampedVersion(pkgDir), /package\.json version is 1\.2\.3/);

  const ebDir = copy();
  const ebPath = join(ebDir, 'electron-builder.yml');
  writeFileSync(ebPath, readFileSync(ebPath, 'utf8').replace(/^buildVersion: .*$/m, 'buildVersion: "999"'));
  assert.throws(() => stampedVersion(ebDir), /buildVersion is 999/);
});
