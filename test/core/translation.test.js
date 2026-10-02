import assert from 'node:assert/strict';
import { test } from 'node:test';

import { faultsOf, parseTranslation, localizeNumber } from '../../app/core/translation.js';
import { category, clone, readJson } from '../helpers.js';

const sample = readJson('test/fixtures/tedim1932.sample.json');
const parse = (raw, identify = 'tedim1932') => parseTranslation(raw, { identify, category });

test('Tedim sample parses; merge 17→18 kept, 18 absent', () => {
  const { meta, chapters, stats } = parse(sample);
  assert.equal(meta.version, 3);
  const gen1 = chapters.find((c) => c.book === 1 && c.chapter === 1).verses;
  assert.equal(gen1[17].merge, 18);
  assert.equal(gen1[18], undefined);
  assert.equal(gen1[1].title, 'Leitung le Mihing Piansakna');
  assert.ok(stats.merges >= 1);
  assert.equal(meta.story[1][1][1].ref, 'Gen.1.1,Gen.2.25');
});

test('identify mismatch is rejected', () => {
  assert.throws(() => parse(sample, 'niv2011'), /expected niv2011, file declares tedim1932/);
});

test('empty optional strings normalise to absent (jwmynwt publishes "title": "")', () => {
  const raw = clone(sample);
  raw.book['1'].chapter['1'].verse['2'] = { text: 'x', title: '', ref: '', merge: '' };
  const v = parse(raw).chapters.find((c) => c.book === 1 && c.chapter === 1).verses[2];
  assert.deepEqual(v, { text: 'x' });
});

test('unknown verse key is a structural error', () => {
  const raw = clone(sample);
  raw.book['1'].chapter['1'].verse['2'].note = 'x';
  assert.throws(() => parse(raw), /\$\.book\.1\.chapter\.1\.verse\.2\.note: unknown verse key/);
});

test('merge must point forward', () => {
  const back = clone(sample);
  back.book['1'].chapter['1'].verse['3'].merge = '2';
  assert.throws(() => parse(back), /verse number greater than 3/);
});

test('faults a file can be read past are recorded, and what can be read is kept', () => {
  const clean = parse(clone(sample));
  assert.deepEqual(faultsOf(clean.diagnostics), {}, 'the sample has none');

  // A verse joined to others that are also given on their own: kept apart.
  const overlap = clone(sample);
  overlap.book['1'].chapter['1'].verse['18'] = { text: 'dup' };
  const joined = parse(overlap);
  const verses = joined.chapters.find((c) => c.book === 1 && c.chapter === 1).verses;
  assert.equal(verses[17].merge, undefined);
  assert.equal(verses[18].text, 'dup');
  assert.equal(joined.stats.merges, clean.stats.merges - 1);
  assert.deepEqual(joined.diagnostics.filter((d) => d.type === 'merge-overlap'), [{ type: 'merge-overlap', book: 1, chapter: 1, verse: 17 }]);

  // A verse with nothing to read.
  const bare = clone(sample);
  bare.book['1'].chapter['1'].verse['2'] = { ref: 'Mat 6:14' };
  const emptied = parse(bare);
  assert.equal(emptied.chapters.find((c) => c.book === 1 && c.chapter === 1).verses[2], undefined);
  assert.equal(emptied.stats.verses, clean.stats.verses - 1);
  assert.deepEqual(faultsOf(emptied.diagnostics), { 'empty-verse': 1 });

  // A book the canon does not have, named and without chapters: left out,
  // and the names, now in an order of their own, are not taken.
  const extra = clone(sample);
  extra.book['67'] = { info: { name: 'Tobit', shortname: 'Tob' }, chapter: {} };
  extra.story = { ...(extra.story ?? {}), 67: { 1: { 1: { text: 'x', ref: '' } } } };
  const outside = parse(extra);
  assert.deepEqual(faultsOf(outside.diagnostics), { 'names-unaligned': 1, 'outside-canon': 1 });
  assert.equal(outside.meta.books[67], undefined);
  assert.equal(outside.meta.books[1].name, category.book(1).name, 'the canon\'s name, not the file\'s');
  assert.notEqual(clean.meta.books[1].name, category.book(1).name, 'which the sample does have of its own');

  // A book whose opening is another's word for word: a converter's filler.
  const filler = clone(sample);
  filler.book['2'] = { chapter: { 1: clone(sample.book['1'].chapter['1']) } };
  const copied = parse(filler);
  assert.equal(copied.meta.books[2], undefined);
  assert.equal(copied.chapters.some((c) => c.book === 2), false);
  assert.deepEqual(copied.diagnostics.find((d) => d.type === 'copied-book'), { type: 'copied-book', book: 2, expected: 1 });
  assert.ok(copied.diagnostics.some((d) => d.type === 'names-unaligned'), 'a book with no info of its own');
});

test('string info.version accepted (bbe1949 publishes "1")', () => {
  const raw = clone(sample);
  raw.info.version = '1';
  assert.equal(parse(raw).meta.version, 1);
});

test('versification differences are diagnostics, not errors', () => {
  const raw = clone(sample);
  delete raw.book['1'].chapter['1'].verse['31'];
  const { diagnostics } = parse(raw);
  assert.ok(diagnostics.some((d) => d.type === 'versification' && d.book === 1 && d.chapter === 1 && d.actual === 30));
});

test('localizeNumber uses the digit table', () => {
  assert.equal(localizeNumber(17, ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']), '၁၇');
  assert.equal(localizeNumber(17, []), '17');
});
