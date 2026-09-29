import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { category, clone, readJson } from '../helpers.js';

test('bundled category.json parses: 66 books, 1189 chapters', () => {
  assert.equal(category.books.length, 66);
  assert.equal(category.books.reduce((n, b) => n + b.chapters, 0), 1189);
  assert.equal(category.verseCount(1, 1), 31);
  assert.equal(category.book(19).chapters, 150);
});

test('clue.v length must match clue.c', () => {
  const raw = clone(readJson('public/category.json'));
  raw.book[0].clue.v.pop();
  assert.throws(() => parseCategory(raw), /\$\.book\[0\]\.clue\.v: has 49 entries but clue\.c is 50/);
});

test('unknown chapter is a RangeError, not undefined', () => {
  assert.throws(() => category.verseCount(1, 51), RangeError);
});

test('the canon carries the verse counts editions actually publish', () => {
  // Four chapters where this canon was one verse short of what published
  // editions carry, so a translation with the extra verse was reported as
  // disagreeing and the chapter's chip under-counted it. The reading surface
  // never clipped them — it draws what the file holds — but the canon is what
  // everything else is measured against, so it has to be right.
  assert.equal(category.verseCount(13, 19), 20, '1 Chronicles 19');
  assert.equal(category.verseCount(14, 13), 23, '2 Chronicles 13');
  assert.equal(category.verseCount(64, 1), 15, '3 John');
  assert.equal(category.verseCount(66, 12), 18, 'Revelation 12');
});
