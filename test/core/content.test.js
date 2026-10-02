import test from 'node:test';
import assert from 'node:assert/strict';
import { contentOf, featuresOf, readContent } from '../../app/core/content.js';
import { parseCatalog } from '../../app/core/catalog.js';

const category = { book: (id) => ({ testament: id <= 39 ? 1 : 2 }) };

test('what a parsed translation carries', () => {
  const parsed = {
    meta: { books: { 1: {}, 19: {}, 40: {} }, story: { 19: { 23: { 1: { text: 'The Lord is my shepherd' } } } } },
    stats: { verses: 120, refs: 7, titles: 2, strongs: { words: 35 } },
  };
  assert.deepEqual({ ...contentOf(parsed, category) }, { ot: 2, nt: 1, verses: 120, strongs: 35, refs: 7, headings: 1, titles: 2 });
});

test('the features worth naming, and only what is there', () => {
  assert.deepEqual(featuresOf({ ot: 39, nt: 27, verses: 1, strongs: 0, refs: 0, headings: 0, titles: 0 }).map((f) => f.id), ['bible']);
  assert.deepEqual(featuresOf({ ot: 0, nt: 27, verses: 1, strongs: 9, refs: 3, headings: 1, titles: 1 }),
    [{ id: 'nt', n: 27 }, { id: 'strongs', n: 9 }, { id: 'refs', n: 3 }, { id: 'headings', n: 2 }]);
  assert.deepEqual(featuresOf(null), []);
});

test('a catalog entry\'s content: optional, and whole when present', () => {
  const entry = (content) => ({
    name: 'c', updated: '2026-10-01T00:00:00Z', version: 1,
    book: [{ identify: 'a', name: 'A', language: { text: 'X', name: 'x', textdirection: 'ltr' }, version: 1, ...(content ? { content } : {}) }],
  });
  assert.equal(parseCatalog(entry(null), { source: 'book.json' }).get('a').content, null);
  const full = { ot: 39, nt: 27, verses: 31102, strongs: 0, refs: 10, headings: 0, titles: 0 };
  assert.deepEqual({ ...parseCatalog(entry(full), { source: 'book.json' }).get('a').content }, full);
  assert.throws(() => parseCatalog(entry({ ...full, refs: -1 }), { source: 'book.json' }), /book\[0\]\.content\.refs/);
  assert.throws(() => readContent({ ot: 1 }, 'book.json', '$.c'), /\$\.c\.nt/);
});

test('faults in the file travel with the figures', () => {
  const base = { ot: 39, nt: 27, verses: 1, strongs: 0, refs: 0, headings: 0, titles: 0 };
  assert.equal(readContent(base, 'book.json', '$').faults, undefined);
  assert.deepEqual({ ...readContent({ ...base, faults: { 'empty-verse': 2 } }, 'book.json', '$').faults }, { 'empty-verse': 2 });
  assert.throws(() => readContent({ ...base, faults: { nonsense: 1 } }, 'book.json', '$'), /expected one of/);
  assert.throws(() => readContent({ ...base, faults: { 'empty-verse': 0 } }, 'book.json', '$'), /above zero/);
});
