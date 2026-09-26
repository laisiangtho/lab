import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { parseCategory } from '../../app/core/category.js';
import { createLookup, parsePassageQuery, passageOf } from '../../app/core/lookup.js';

const category = parseCategory(JSON.parse(readFileSync(new URL('../../public/category.json', import.meta.url), 'utf8')));
const lookup = createLookup({ category });
const ask = (text) => parsePassageQuery(text, lookup);
const name = (id) => category.book(id).name;

test('a book on its own', () => {
  assert.equal(name(ask('genesis').books[0]), 'Genesis');
  assert.equal(name(ask('gen').books[0]), 'Genesis');
  assert.equal(ask('gen').chapter, null);
});

test('book and chapter, however it is spelled', () => {
  for (const text of ['ps 2', 'psa 2', 'psalm 2', 'Psalm 2', 'PS2', 'ps  2']) {
    const query = ask(text);
    assert.equal(name(query.books[0]), 'Psalm', text);
    assert.equal(query.chapter, 2, text);
  }
});

test('chapter and verse, and a run of verses', () => {
  assert.deepEqual(pick(ask('ps 3:5')), { book: 'Psalm', chapter: 3, verse: 5, to: null });
  assert.deepEqual(pick(ask('psa 3:2-4')), { book: 'Psalm', chapter: 3, verse: 2, to: 4 });
  assert.deepEqual(pick(ask('psa 3.2'), false), { book: 'Psalm', chapter: 3, verse: 2 }, 'a full stop separates too');
  assert.equal(ask('ps 3-5').to, null, 'without a verse, a dash is not a run of verses');
});

test('a numbered book keeps its number', () => {
  assert.equal(name(ask('1 jn 2:1').books[0]), '1 John');
  assert.equal(name(ask('2sam 4').books[0]), '2 Samuel');
});

test('a prefix that fits several books offers all of them', () => {
  const query = ask('jo 3');
  assert.deepEqual(query.books.map(name), ['John', 'Joshua', 'Job', 'Joel', 'Jonah'],
    'the canon abbreviates John "Jo", and the rest are still offered');
  assert.equal(query.exact, true);
  assert.deepEqual(ask('jos 3').books.map(name), ['Joshua'], 'a longer token narrows it');
  assert.deepEqual(ask('zep 1').books.map(name), ['Zephaniah']);
});

test('what is not a reference says so', () => {
  assert.equal(ask(''), null);
  assert.equal(ask('   '), null);
  assert.equal(ask('zzzz 3'), null, 'no book of that name');
  assert.equal(ask('3'), null, 'a bare number needs a book to belong to');
});

test('the translation\'s own names and numerals are understood', () => {
  const burmese = createLookup({
    category,
    bookName: (id) => (id === 1 ? 'ကမ္ဘာဦးကျမ်း' : category.book(id).name),
    digits: ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'],
  });
  const query = parsePassageQuery('ကမ္ဘာဦးကျမ်း ၃:၅', burmese);
  assert.equal(query.books[0], 1);
  assert.equal(query.chapter, 3);
  assert.equal(query.verse, 5);
});

test('a chapter past the end of a book lands on its last one', () => {
  assert.deepEqual(passageOf(ask('gen 900'), 1, lookup), { book: 1, chapter: 50, verse: null, to: null });
  assert.deepEqual(passageOf(ask('gen'), 1, lookup), { book: 1, chapter: 1, verse: null, to: null });
});

function pick(query, withRange = true) {
  const passage = passageOf(query, query.books[0], lookup);
  const out = { book: name(passage.book), chapter: passage.chapter, verse: passage.verse };
  if (withRange) out.to = passage.to;
  return out;
}
