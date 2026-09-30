import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codeRanges, editionCodes, extractStrongs, hasStrongs, kindOf, normalizeCode, plainText, plainVerses, strongsRuns, tallyStrongs,
} from '../../app/core/strongs.js';

test('text without markup is returned untouched', () => {
  const plain = 'In the beginning God created the heavens and the earth.';
  assert.equal(hasStrongs(plain), false);
  assert.deepEqual(extractStrongs(plain), { text: plain, codes: [] });
  assert.deepEqual(strongsRuns(plain), [{ text: plain, code: null, codes: [] }]);
  assert.equal(plainText(plain), plain);
});

test('brace, tag and bracket notations all read', () => {
  for (const marked of ['In the beginning{H7225} God{H430} created', 'In the beginning<S>7225</S> God<S>430</S> created', 'In the beginning[H7225] God[H430] created']) {
    const { text, codes } = extractStrongs(marked);
    assert.equal(text, 'In the beginning God created');
    assert.deepEqual(codes.map((c) => c.code), ['H7225', 'H430'].map((c) => (marked.includes('<S>') ? c.replace('H', '') : c)));
  }
});

test('a code attaches to the word before it', () => {
  const runs = strongsRuns('In the beginning{H7225} God{H430} created');
  assert.deepEqual(runs, [
    { text: 'In the ', code: null, codes: [] },
    { text: 'beginning', code: 'H7225', codes: ['H7225'] },
    { text: ' ', code: null, codes: [] },
    { text: 'God', code: 'H430', codes: ['H430'] },
    { text: ' created', code: null, codes: [] },
  ]);
});

test('codes normalise', () => {
  assert.equal(normalizeCode('h0430'), 'H430');
  assert.equal(normalizeCode('G0026'), 'G26');
  assert.equal(normalizeCode('0026'), '26');
});

test('a code keeps its sense letter, and a malformed one is refused', () => {
  assert.equal(normalizeCode('h01254a'), 'H1254A');
  assert.equal(plainText('created{H1254a} the'), 'created the');
  assert.throws(() => normalizeCode('H'), /not a Strong's number/);
});

test('numbers past the end of the lexicon are the edition’s own', () => {
  assert.equal(kindOf('H8674'), 'strongs');
  assert.equal(kindOf('H8675'), 'edition');
  assert.equal(kindOf('H9999'), 'edition');
  assert.equal(kindOf('G5624'), 'strongs');
  assert.equal(kindOf('G5625'), 'edition');
  assert.equal(kindOf('430'), 'strongs');
  assert.equal(kindOf('H0'), 'edition');
});

// eBible.org's tagged Judson Bible, as the importer stores it: Burmese runs
// words together, and H9999 marks the particles with nothing behind them.
const JUDSON = 'အစ{H7225}အဦး၌{H9996}ဘုရားသခင်{H430}သည် ကောင်းကင်{H8064}နှင့်{H9999}မြေကြီး{H776}ကို';

test('a tagged Burmese verse reads plainly, and its words stay whole', () => {
  assert.equal(plainText(JUDSON), 'အစအဦး၌ဘုရားသခင်သည် ကောင်းကင်နှင့်မြေကြီးကို');
  const marked = strongsRuns(JUDSON).filter((run) => run.code);
  assert.deepEqual(marked.map((run) => [run.text, run.code]), [
    ['အစ', 'H7225'], ['ဘုရားသခင်', 'H430'], ['ကောင်းကင်', 'H8064'], ['မြေကြီး', 'H776'],
  ], 'the edition numbers are not links, and no word swallows its neighbour');
  assert.equal(strongsRuns(JUDSON).map((run) => run.text).join(''), plainText(JUDSON), 'nothing is lost between runs');
});

test('a code after a space belongs to the word before it, and the spaces close up', () => {
  const { text, codes } = extractStrongs('the waters {H4325} of the deep');
  assert.equal(text, 'the waters of the deep');
  assert.equal(text.slice(0, codes[0].at), 'the waters');
});

test('a word may carry several numbers', () => {
  const runs = strongsRuns('created{H1254}{H853} the');
  assert.deepEqual(runs[0], { text: 'created', code: 'H1254', codes: ['H1254', 'H853'] });
});

test('what a translation carries is counted, edition numbers by name', () => {
  const tally = tallyStrongs(JUDSON);
  tallyStrongs('word{G26}{G27} other{G5625}', tally);
  assert.equal(tally.words, 5);
  assert.deepEqual(tally.edition, { H9996: 1, H9999: 1, G5625: 1 });
  assert.deepEqual(editionCodes(tally, 2), [['G5625', 1], ['H9996', 1]]);
});

test('a chapter comes back as it was when nothing in it is marked', () => {
  const verses = { 1: { text: 'plain' } };
  assert.equal(plainVerses(verses), verses);
  const marked = plainVerses({ 1: { text: 'God{H430} said', title: 'x' }, 2: { text: 'plain' } });
  assert.deepEqual(marked, { 1: { text: 'God said', title: 'x' }, 2: { text: 'plain' } });
});

test('a search for a number finds the word it is on', () => {
  const text = 'In the beginning{H7225} God{H430} created';
  const plain = plainText(text);
  assert.deepEqual(codeRanges(text).map(({ code, from, to }) => [code, plain.slice(from, to)]), [['H7225', 'beginning'], ['H430', 'God']]);
});
