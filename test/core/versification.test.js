import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapVerse, numberingOf } from '../../app/core/versification.js';

const at = (book, chapter, verse) => ({ book, chapter, verse });

test('English to Hebrew where they differ, and the same verse where they do not', () => {
  assert.deepEqual(mapVerse(at(39, 4, 1), 'english', 'hebrew'), [at(39, 3, 19)], 'Malachi 4:1 is Hebrew 3:19');
  assert.deepEqual(mapVerse(at(39, 4, 6), 'english', 'hebrew'), [at(39, 3, 24)]);
  assert.deepEqual(mapVerse(at(19, 51, 1), 'english', 'hebrew'), [at(19, 51, 3)], 'a psalm with a two-verse title');
  assert.deepEqual(mapVerse(at(19, 51, 0), 'english', 'hebrew'), [at(19, 51, 1), at(19, 51, 2)], 'the title itself');
  assert.deepEqual(mapVerse(at(29, 2, 28), 'english', 'hebrew'), [at(29, 3, 1)], 'Joel 2:28');
  assert.deepEqual(mapVerse(at(1, 31, 55), 'english', 'hebrew'), [at(1, 32, 1)]);
  assert.deepEqual(mapVerse(at(1, 1, 1), 'english', 'hebrew'), [at(1, 1, 1)]);
  assert.deepEqual(mapVerse(at(43, 3, 16), 'english', 'hebrew'), [at(43, 3, 16)], 'the New Testament is untouched');
});

test('Hebrew back to English', () => {
  assert.deepEqual(mapVerse(at(39, 3, 19), 'hebrew', 'english'), [at(39, 4, 1)]);
  assert.deepEqual(mapVerse(at(19, 51, 3), 'hebrew', 'english'), [at(19, 51, 1)]);
  assert.deepEqual(mapVerse(at(19, 51, 1), 'hebrew', 'english'), [at(19, 51, 0)], 'the title is verse 0 in English');
  assert.deepEqual(mapVerse(at(1, 32, 1), 'hebrew', 'english'), [at(1, 31, 55)]);
});

test('a numbering that is not one is refused', () => {
  assert.throws(() => mapVerse(at(1, 1, 1), 'english', 'latin'), /no numbering "latin"/);
});

test('which numbering a text follows, from the chapters it has', () => {
  assert.equal(numberingOf((b, c) => b === 39 && c === 4), 'english');
  assert.equal(numberingOf((b, c) => b === 29 && c === 4), 'hebrew');
  assert.equal(numberingOf(() => false), 'english', 'a New Testament');
  assert.equal(numberingOf(() => false, { hebrew: true }), 'hebrew', 'a Hebrew portion follows its language');
  assert.equal(numberingOf((b, c) => b === 39 && c === 4, { hebrew: true }), 'english', 'unless its chapters say otherwise');
});
