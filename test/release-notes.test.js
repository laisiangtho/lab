/**
 * Release notes: which commits are listed, how they are shortened, and which
 * tag counts as the previous release.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatNotes, newestTag, shorten, worthListing } from '../scripts/release-notes.mjs';

const c = (subject, hash = 'abcdef0123456789') => ({ hash, subject });

test('the previous release is the newest stamped tag, compared as numbers', () => {
  assert.equal(newestTag(['v26.09.29.9', 'v26.09.29.10', 'v26.09.28.12']), 'v26.09.29.10');
  assert.equal(newestTag(['v26.10.01.1', 'v26.09.30.40']), 'v26.10.01.1');
  assert.equal(newestTag(['v0.2.0', '0.0.1-alpha', 'v26.09.29.11']), 'v26.09.29.11');
  assert.equal(newestTag(['v0.2.0', '0.0.1-alpha']), null);
  assert.equal(newestTag([]), null);
});

test('release and merge commits are left out', () => {
  assert.equal(worthListing('release:all 26.09.29.11'), false);
  assert.equal(worthListing('Release:web retry'), false);
  assert.equal(worthListing("Merge branch 'master' of github.com:laisiangtho/lab"), false);
  assert.equal(worthListing('Merge pull request #4 from x/y'), false);
  assert.equal(worthListing('fix(test): ask the electron package for its binary'), true);
  assert.equal(worthListing('docs: how a release is made'), true);
});

test('a long subject is cut, a short one kept whole', () => {
  assert.equal(shorten('  feat:   two   spaces  '), 'feat: two spaces');
  const long = `feat: ${'x'.repeat(100)}`;
  const cut = shorten(long);
  assert.equal(cut.length, 72);
  assert.ok(cut.endsWith('…'));
});

test('the notes list each change once, newest first, with its short hash', () => {
  const notes = formatNotes({
    previous: 'v26.09.29.11',
    commits: [
      c('release:desktop 26.09.29.12', '1111111aaaa'),
      c('build: more download formats', '2222222bbbb'),
      c('fix: typo', '3333333cccc'),
      c('fix: typo', '4444444dddd'),
    ],
  });
  const [first, second, third] = notes.split('\n');
  assert.equal(first, '- build: more download formats (2222222)');
  assert.equal(second, '- fix: typo (3333333)');
  assert.equal(third, '');
  assert.match(notes, /^Since v26\.09\.29\.11\.$/m);
  assert.doesNotMatch(notes, /release:desktop/);
  assert.match(notes, /<details><summary>First run on Windows and macOS<\/summary>/);
});

test('a release with nothing but the version change says so', () => {
  const notes = formatNotes({ previous: 'v26.09.29.11', commits: [c('release:web retry')] });
  assert.match(notes, /^No changes since v26\.09\.29\.11 other than the version\.$/m);
  assert.match(formatNotes({ previous: null, commits: [] }), /^First release\.$/m);
});

test('a long run of changes is capped, with the rest counted', () => {
  const commits = Array.from({ length: 30 }, (_, i) => c(`fix: change ${i}`));
  const notes = formatNotes({ previous: 'v26.09.29.11', commits });
  assert.equal(notes.split('\n').filter((l) => l.startsWith('- fix:')).length, 25);
  assert.match(notes, /^- …and 5 more$/m);
});
