import { strict as assert } from 'node:assert';
import test from 'node:test';

import { baseCode, languageName, sameLanguage, toTag, twoLetter } from '../../app/core/langcode.js';

test('a three-letter code becomes the two-letter one the browser knows', () => {
  assert.equal(twoLetter('mya'), 'my');
  assert.equal(twoLetter('nob'), 'nb');
  assert.equal(twoLetter('heb'), 'he');
  assert.equal(twoLetter('dan'), 'da');
  assert.equal(twoLetter('eng'), 'en');
  // Macrolanguage members answer with the macrolanguage's code, which is what
  // a voice reports.
  assert.equal(twoLetter('cmn'), 'zh');
  assert.equal(twoLetter('arb'), 'ar');
  assert.equal(twoLetter('swh'), 'sw');
});

test('a language with no two-letter code says so rather than guessing', () => {
  // The languages this app exists for, most of which have no 639-1 at all.
  for (const code of ['ctd', 'lus', 'kac', 'shn', 'tpi', 'grc']) {
    assert.equal(twoLetter(code), null, `${code} has no 639-1`);
  }
  assert.equal(twoLetter(''), null);
  assert.equal(twoLetter(null), null);
  assert.equal(twoLetter('nonsense'), null);
});

test('a two-letter code, or one with a region, is already the answer', () => {
  assert.equal(twoLetter('my'), 'my');
  assert.equal(twoLetter('my-MM'), 'my');
  assert.equal(twoLetter('pt_BR'), 'pt');
  assert.equal(baseCode('  EN-gb '), 'en');
});

test('a tag is always something: the short code, or the code as given', () => {
  assert.equal(toTag('mya'), 'my');
  assert.equal(toTag('ctd'), 'ctd', 'lang="ctd" is correct, merely unrecognised');
  assert.equal(toTag('my-MM'), 'my');
  assert.equal(toTag(''), '');
});

test('two codes name the same language when their tags agree', () => {
  assert.ok(sameLanguage('mya', 'my-MM'), 'a file and a voice, agreeing');
  assert.ok(sameLanguage('nob', 'nb-NO'));
  assert.ok(sameLanguage('ctd', 'ctd'));
  assert.ok(!sameLanguage('ctd', 'my'), 'Tedim is not Burmese');
  assert.ok(!sameLanguage('eng', 'nor'));
  assert.ok(!sameLanguage('', 'en'), 'nothing is not a language');
});

test('a code can be named, and an unnamed one names itself', () => {
  assert.match(languageName('mya', 'en'), /Burmese/);
  assert.equal(languageName('ctd', 'en'), 'ctd', 'no invented name for a language the table does not know');
  assert.equal(languageName(''), '');
});
