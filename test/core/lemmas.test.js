import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { readBrowserBible } from '../../app/core/formats/browserbible.js';
import { completeRaw } from '../../app/core/formats/index.js';
import { buildLemmaIndex, renderings, sameNumber, taggedWords } from '../../app/core/lemmas.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));
const kjv = () => {
  const files = ['info.json', 'GN1.html', 'JN3.html'].map((name) => ({ name, text: readFileSync(root(`test/fixtures/browserbible/eng_kjv2006/${name}`), 'utf8') }));
  const { raw } = readBrowserBible(files, {});
  return parseTranslation(completeRaw(raw, { source: 'kjv', category, info: { identify: 'kjv' } }), { identify: 'kjv', category });
};

test('a real KJV: every word it uses for a number, with counts and verses', () => {
  const index = buildLemmaIndex(kjv().chapters, { version: 1 });
  const god = renderings(index, 'H430');
  assert.ok(god.n >= 32, `God is in nearly every verse of Genesis 1 (${god.n})`);
  assert.equal(god.words[0].word, 'God');
  assert.equal(god.words[0].refs[0], '1.1.1');
  assert.ok(god.words[0].refs.every((ref, i, all) => i === 0 || all[i - 1] !== ref), 'a verse once per word');
  const greek = renderings(index, 'G25');
  assert.ok(greek.words.some((w) => /loved/.test(w.word)), `John 3:16, "loved" (${JSON.stringify(greek.words.map((w) => w.word))})`);
});

test('a Burmese verse that runs words together keeps each rendering whole', () => {
  const rows = [{ book: 1, chapter: 1, verses: {
    1: { text: 'အစ{H7225}အဦး၌{H9996}ဘုရားသခင်{H430}သည် ကောင်းကင်{H8064}နှင့်{H9999}မြေကြီး{H776}ကို' },
    2: { text: 'ဘုရားသခင်{H430}၏ ဝိညာဉ်{H7307}' },
  } }];
  const index = buildLemmaIndex(rows);
  assert.deepEqual(renderings(index, 'H430').words.map(({ word, n, refs }) => [word, n, refs]), [['ဘုရားသခင်', 2, ['1.1.1', '1.1.2']]]);
  assert.equal(index.codes.H9999, undefined, 'the edition\'s own numbers are not gathered');
});

test('senses: a plain number gathers its senses, a lettered one is itself', () => {
  const index = buildLemmaIndex([{ book: 1, chapter: 1, verses: { 1: { text: 'created{H1254A} fat{H1254B}' } } }]);
  assert.equal(renderings(index, 'H1254').n, 2);
  assert.equal(renderings(index, 'H1254A').n, 1);
  assert.equal(sameNumber('H1254', 'H1254A'), true);
  assert.equal(sameNumber('H1254A', 'H1254B'), false);
});

test('an original verse as tagged words with their morphology', () => {
  const words = taggedWords('בְּרֵאשִׁית{H7225:HR/Ncfsa} בָּרָא{H1254A:HVqp3ms} אֱלֹהִים{H430:HNcmpa}׃');
  assert.deepEqual(words.map(({ codes, morphs }) => [codes[0], morphs[0]]), [['H7225', 'HR/Ncfsa'], ['H1254A', 'HVqp3ms'], ['H430', 'HNcmpa']]);
});

test('Hebrew: cantillation does not make a word into two renderings', () => {
  const files = ['info.json', 'GN1.html'].map((name) => ({ name, text: readFileSync(root(`test/fixtures/browserbible/heb_wlc/${name}`), 'utf8') }));
  const { raw } = readBrowserBible(files, {});
  const wlc = parseTranslation(completeRaw(raw, { source: 'wlc', category, info: { identify: 'wlc' } }), { identify: 'wlc', category });
  const index = buildLemmaIndex(wlc.chapters);
  const created = renderings(index, 'H1254');
  // Genesis 1 spells בָּרָא with several different accents; it is one word.
  const words = created.words.map((w) => w.word);
  assert.equal(new Set(words).size, words.length);
  assert.ok(words.every((w) => !/[\u0591-\u05AF\u05BD\u05C0]/.test(w)), `no accents left (${words})`);
  assert.equal(created.words.reduce((n, w) => n + w.n, 0), created.n, 'every occurrence counted once');
  assert.ok(created.words.length <= 3, `the accented spellings fold together (${words})`);
});
