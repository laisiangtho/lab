import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { convert } from '../../app/core/formats/index.js';
import { extractStrongs, plainText } from '../../app/core/strongs.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));
const fixture = (name) => readFileSync(root(`test/fixtures/originals/${name}`), 'utf8');

test('OpenScriptures Hebrew: numbers lettered by the book, senses and morphology kept, prefixes joined', () => {
  const { raw } = convert({ text: fixture('wlc-gen1-1-5.osis.xml'), format: 'xml', source: 'Gen.xml', category, info: { identify: 'wlc', name: 'WLC', language: 'hbo' } });
  const parsed = parseTranslation(raw, { identify: 'wlc', category });
  const verse = parsed.chapters.find((row) => row.book === 1 && row.chapter === 1).verses[1];
  // Compared normalised: the file's order of combining marks is kept as it is
  // (Hebrew marks are a known case where canonical reordering changes text).
  assert.equal(plainText(verse.text).normalize('NFC'), 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃'.normalize('NFC'), 'the words, with no morpheme slashes');
  assert.ok(!plainText(verse.text).includes('/'), 'no slash in the words (the morphology keeps its own)');
  const { codes } = extractStrongs(verse.text);
  assert.deepEqual(codes.map(({ code, morph }) => `${code}:${morph}`), [
    'H7225:HR/Ncfsa', 'H1254A:HVqp3ms', 'H430:HNcmpa', 'H853:HTo', 'H8064:HTd/Ncmpa', 'H853:HC/To', 'H776:HTd/Ncfsa',
  ]);
  assert.equal(Object.keys(parsed.chapters.find((row) => row.book === 1 && row.chapter === 1).verses).length, 5);
});
