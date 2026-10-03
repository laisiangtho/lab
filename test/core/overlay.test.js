import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyStrongs, overlayInfo, verseHash, wordsOf } from '../../app/core/overlay.js';
import { plainText, strongsRuns } from '../../app/core/strongs.js';

const text = 'Topa in tuu cin’ bang-a kei hong cingpa hi a, bangmah ka kisam kei ding hi.';
const w = ['H3068', 'H9999', 'H7462', 'H7462', 'H9999', null, 'H9999', 'H7462', 'H9999', 'H9999', null, 'H9999', 'H2637', 'H3808', 'H9999', 'H9999'];

test('the hash is FNV-1a over UTF-8', () => {
  assert.equal(verseHash(''), '811c9dc5');
  assert.equal(verseHash('a'), 'e40c292c');
  assert.notEqual(verseHash('cin’'), verseHash("cin'"));
});

test('a verse takes its numbers and gives its text back unchanged', () => {
  assert.equal(wordsOf(text).length, w.length);
  const tagged = applyStrongs(text, { w, of: verseHash(text) });
  assert.equal(plainText(tagged), text);
  assert.match(tagged, /cin’\{H7462\} /);
  assert.match(tagged, /hi\{H9999\}\.$/);
  assert.deepEqual(strongsRuns(tagged).filter((run) => run.code).map((run) => `${run.text}=${run.code}`),
    ['Topa=H3068', 'tuu=H7462', 'cin’=H7462', 'cingpa=H7462', 'kisam=H2637', 'kei=H3808']);
});

test('a changed verse, a wrong count and a number on punctuation are refused', () => {
  assert.throws(() => applyStrongs(`${text} `, { w, of: verseHash(text) }, 'Ps 23:1'), /Ps 23:1: made for text/);
  assert.throws(() => applyStrongs(text, { w: w.slice(1), of: verseHash(text) }), /15 entries for 16 words/);
  assert.throws(() => applyStrongs('Topa ’ inn', { w: ['H3068', 'H1004', 'H1004'], of: verseHash('Topa ’ inn') }), /not a word/);
});

test('the header names the translation and the kind', () => {
  const raw = { info: { identify: '3561', kind: 'strongs', version: 1, review: true }, book: {} };
  assert.deepEqual(overlayInfo(raw, { identify: '3561', kind: 'strongs' }), { identify: '3561', kind: 'strongs', version: 1, review: true });
  assert.throws(() => overlayInfo(raw, { identify: '3561', kind: 'refs' }), /expected kind refs/);
  assert.throws(() => overlayInfo(raw, { identify: '1', kind: 'strongs' }), /expected identify 1/);
});

test('overlays are laid over a translation file: numbers into the text, references where there are none', async () => {
  const { applyOverlays, parseOverlayIndex } = await import('../../app/core/overlay.js');
  const raw = { info: { identify: 'x1' }, book: { 19: { chapter: { 23: { verse: {
    1: { text: 'Topa in kei hong cingpa hi.' },
    2: { text: 'Lo nona-ah keimah hong lumsak a.', ref: 'Eze 34:14' },
    3: { text: 'Ka nuntakna tha hong dimsak a.' },
  } } } } } };
  const verse = (n) => raw.book[19].chapter[23].verse[n];
  const strongs = { info: { identify: 'x1', kind: 'strongs', version: 2, review: true, method: 'by hand', sources: ['a', 'b'] }, book: { 19: { chapter: { 23: { verse: {
    1: { w: ['H3068', 'H9999', null, null, 'H7462', 'H9999'], of: verseHash(verse(1).text) },
    2: { w: ['H1877', null, null, null, 'H7257', null], of: 'deadbeef' },
    9: { w: ['H1'], of: 'deadbeef' },
  } } } } } };
  const refs = { info: { identify: 'x1', kind: 'refs', version: 1, review: false }, book: { 19: { chapter: { 23: { verse: {
    1: { ref: 'Isa 40:11; Joh 10:11' }, 2: { ref: 'Rev 7:17' },
  } } } } } };
  const done = applyOverlays(raw, { strongs, refs });
  assert.equal(verse(1).text, 'Topa{H3068} in{H9999} kei hong cingpa{H7462} hi{H9999}.');
  assert.equal(verse(2).text, 'Lo nona-ah keimah hong lumsak a.', 'a verse the overlay was not made for is left as it was');
  assert.equal(verse(1).ref, 'Isa 40:11; Joh 10:11');
  assert.equal(verse(2).ref, 'Eze 34:14', 'the master\'s own references are kept');
  assert.deepEqual(done.strongs, { version: 2, review: true, verses: 1, refused: 2, refusedAt: ['19.23.2', '19.23.9'], method: 'by hand', sources: ['a', 'b'] });
  assert.equal(done.refs.verses, 1);
  assert.equal(done.refs.refused, 0);
  assert.throws(() => applyOverlays(raw, { strongs: { ...strongs, info: { ...strongs.info, identify: 'x2' } } }), /expected identify x1/);

  const index = parseOverlayIndex({ overlays: [{ identify: 'x1', version: 2, review: true, verses: 3, words: 9, bytes: 100 }] }, 'strongs');
  assert.deepEqual({ ...index.get('x1') }, { identify: 'x1', version: 2, review: true, verses: 3, bytes: 100 });
  assert.throws(() => parseOverlayIndex({}, 'refs'), /refs\/index\.json: expected/);
  assert.throws(() => parseOverlayIndex({ overlays: [{ identify: 'a', version: 1 }, { identify: 'a', version: 1 }] }, 'refs'), /listed twice/);
});
