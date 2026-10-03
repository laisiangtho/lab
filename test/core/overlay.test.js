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
