import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chapterAgainstCanon, createExamination, groupByBook, headingsOf, lastCoveredVerse } from '../../app/core/examine.js';
import { category } from '../helpers.js';

const verses = (spec) => Object.fromEntries(Object.entries(spec)
  .map(([n, v]) => [n, typeof v === 'string' ? { text: v } : v]));

/** A whole chapter of a book, as the canon says it should be. */
const wholeChapter = (book, chapter) => verses(Object.fromEntries(
  Array.from({ length: category.book(book).verses[chapter - 1] }, (_, i) => [i + 1, 'text'])));

test('a merge counts as reaching its far end', () => {
  assert.equal(lastCoveredVerse(verses({ 1: 'a', 2: 'b' })), 2);
  assert.equal(lastCoveredVerse(verses({ 1: 'a', 2: { text: 'b', merge: '4' } })), 4);
  // The importers write a merge as a string and the store keeps it as a
  // number; the rule has to read both or a chapter reports differently
  // depending on which door it came in by.
  assert.equal(lastCoveredVerse(verses({ 1: { text: 'a', merge: 3 } })), 3);
});

test('a chapter agrees with the canon, is short, or is past its end', () => {
  assert.equal(chapterAgainstCanon(category, 1, 1, wholeChapter(1, 1)), null);

  const short = chapterAgainstCanon(category, 1, 1, verses({ 1: 'a', 2: 'b' }));
  assert.equal(short.type, 'versification');
  assert.equal(short.actual, 2);
  assert.equal(short.expected, category.book(1).verses[0]);

  const past = chapterAgainstCanon(category, 1, 999, verses({ 1: 'a' }));
  assert.equal(past.type, 'extra-chapter');
  assert.equal(past.expected, category.book(1).chapters);

  // A merge covering the last verse is a chapter that agrees, which is the
  // whole point of counting merges: without it every merged verse in a real
  // edition reads as a chapter one short.
  const last = category.book(1).verses[0];
  const merged = wholeChapter(1, 1);
  delete merged[last];
  merged[last - 1] = { text: 'both', merge: String(last) };
  assert.equal(chapterAgainstCanon(category, 1, 1, merged), null);
});

test('one pass answers where the merges, the differences and the bare chapters are', () => {
  const pass = createExamination({
    category,
    story: { 1: { 1: { 3: { text: 'The first day' } } } },
  });
  pass.visit({ book: 1, chapter: 1, verses: wholeChapter(1, 1) });
  pass.visit({ book: 1, chapter: 2, verses: verses({ 1: 'a', 2: { text: 'b', merge: '5' } }) });
  pass.visit({ book: 1, chapter: 3, verses: verses({ 1: { text: 'a', title: 'A heading' } }) });

  const found = pass.report();
  assert.deepEqual(found.merges, [{ book: 1, chapter: 2, verse: 2, to: 5, span: 4 }]);
  assert.equal(found.count.merges, 1);
  assert.equal(found.count.stories, 1);
  assert.equal(found.count.titles, 1);
  // Chapter 1 is headed by the story, chapter 3 by its verse title; only
  // chapter 2 has nothing.
  assert.equal(found.count.headed, 2);
  assert.deepEqual(found.bare, [{ book: 1, chapter: 2 }]);

  // 65 books never visited, and the two chapters that do not match.
  assert.equal(found.books, 1);
  assert.equal(found.count.missing, category.books.length - 1);
  assert.equal(found.count.short, 2);
  assert.equal(found.count.extra, 0);
  assert.equal(found.count.total, found.count.missing + 2);
  assert.equal(found.canon.filter((f) => f.type === 'missing-book').length, category.books.length - 1);
  assert.ok(!found.capped);
});

test('a badly broken translation caps its lists and says so, but not its counts', () => {
  const pass = createExamination({ category, limit: 3 });
  for (let chapter = 1; chapter <= 20; chapter += 1) {
    pass.visit({ book: 19, chapter, verses: verses({ 1: 'only one verse' }) });
  }
  const found = pass.report();
  assert.equal(found.count.short, 20, 'every one of them is counted');
  assert.ok(found.canon.length <= 3, 'and at most three are listed');
  assert.ok(found.capped, 'and the reader is told the list was cut');
});

test('headings come back in verse order, pericope before sub-heading', () => {
  const rows = headingsOf({
    book: 19, chapter: 23,
    story: { 1: { text: 'The good shepherd' } },
    verses: verses({ 1: { text: 'a', title: 'Of David' }, 4: { text: 'b', title: 'The valley' } }),
  });
  assert.deepEqual(rows.map((r) => [r.verse, r.level, r.text]), [
    [1, 1, 'The good shepherd'],
    [1, 2, 'Of David'],
    [4, 2, 'The valley'],
  ]);
  assert.deepEqual(headingsOf({ book: 1, chapter: 1, verses: verses({ 1: 'a' }) }), []);
});

test('a book is the row, and the kinds of finding are numbers on it', () => {
  const pass = createExamination({ category, story: { 19: { 23: { 1: { text: 'The good shepherd' } } } } });
  pass.visit({ book: 19, chapter: 23, verses: verses({ 1: { text: 'a', title: 'Of David' }, 2: { text: 'b', merge: '3' } }) });
  pass.visit({ book: 19, chapter: 1, verses: wholeChapter(19, 1) });
  const meta = { books: { 19: { name: 'Salmernes Bog', desc: 'Samlet gennem mange århundreder.' } } };
  const { byBook: books } = pass.report(meta);

  assert.equal(books.length, category.books.length, 'every book of the canon has a row');
  const psalms = books.find((b) => b.id === 19);
  assert.equal(psalms.name, 'Salmernes Bog', 'named as the edition names it');
  assert.equal(psalms.english, 'Psalm', 'and as the canon does, for anyone who cannot read that');
  assert.match(psalms.desc, /Samlet/);
  assert.equal(psalms.present, true);
  assert.equal(psalms.merges, 1);
  assert.equal(psalms.headings, 2, 'the pericope heading and the sub-heading together');
  assert.equal(psalms.lengths, 1, 'chapter 23 is two verses long and the canon says more');

  // Only the chapters with something to say about them are rows.
  assert.deepEqual(psalms.chapters.map((c) => c.chapter), [23]);
  const [ch] = psalms.chapters;
  assert.equal(ch.headings, 2);
  assert.equal(ch.merges.length, 1);
  assert.equal(ch.merges[0].to, 3);
  assert.equal(ch.length.type, 'versification');

  const genesis = books.find((b) => b.id === 1);
  assert.equal(genesis.present, false, 'a book never visited is not here');
  assert.equal(genesis.chapters.length, 0, 'and has nothing under it');
});

test('before the pass, a count that needs one is unknown rather than zero', () => {
  const rows = groupByBook({
    category,
    meta: { books: { 1: { name: 'Genesis' } } },
    canon: [{ type: 'versification', book: 1, chapter: 1, expected: 31, actual: 30 }],
  });
  const genesis = rows.find((b) => b.id === 1);
  assert.equal(genesis.merges, null, 'nothing on the record says where the merges are');
  assert.equal(genesis.headings, null);
  assert.equal(genesis.lengths, 1, 'but the record does carry this');
  assert.equal(genesis.present, true, 'and the edition has the book');
});
