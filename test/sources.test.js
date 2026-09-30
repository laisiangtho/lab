/**
 * Translation sources besides the catalog: getBible's list, eBible.org's CSV,
 * the getBible file format, and telling what is already on the device.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCategory } from '../app/core/category.js';
import { convert, describe, sniff } from '../app/core/formats/index.js';
import { normalName, onDevice, readEbibleCsv, readGetBibleList } from '../app/core/sources.js';
import { parseTranslation } from '../app/core/translation.js';
import { root } from './helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));

test("getBible's list", () => {
  const rows = readGetBibleList({
    kjv: { translation: 'King James Version', abbreviation: 'kjv', lang: 'en', language: 'English', direction: 'LTR', distribution_license: 'Public Domain', url: 'https://api.getbible.net/v2/kjv.json' },
    aleppo: { translation: 'Aleppo Codex', abbreviation: 'aleppo', lang: 'he', language: 'Hebrew', direction: 'RTL', url: 'https://api.getbible.net/v2/aleppo.json' },
    broken: { translation: 'No file' },
  });
  assert.deepEqual(rows.map((r) => r.identify), ['gb-kjv', 'gb-aleppo'], 'by language, and one without a file left out');
  assert.equal(rows[1].direction, 'rtl');
  assert.equal(rows[0].kind, 'getbible');
  assert.throws(() => readGetBibleList([]), /not an object keyed by abbreviation/);
});

test("eBible.org's list: columns by name, only what may be shared", () => {
  const csv = [
    'languageCode,translationId,languageName,languageNameInEnglish,title,shortTitle,Redistributable,Copyright,UpdateDate,textDirection,downloadable',
    'eng,engkjv,English,English,"King James Version, 1769",KJV,True,Public Domain,2024-01-02,ltr,True',
    'heb,hebwlc,עברית,Hebrew,Westminster Leningrad Codex,WLC,True,Public Domain,2023-05-01,rtl,True',
    'eng,engnope,English,English,Not Shared,NS,False,All rights reserved,2024-01-02,ltr,True',
  ].join('\n');
  const rows = readEbibleCsv(csv);
  assert.deepEqual(rows.map((r) => r.id), ['engkjv', 'hebwlc']);
  assert.equal(rows[0].name, 'King James Version, 1769', 'a quoted comma stays in the name');
  assert.equal(rows[0].url, 'https://ebible.org/Scriptures/engkjv_usfx.zip');
  assert.equal(rows[1].direction, 'rtl');
  assert.throws(() => readEbibleCsv('translationId,title\nx,y'), /no languageCode column/);
});

test("getBible's file format imports like any other", () => {
  const file = JSON.stringify({
    translation: 'King James Version', abbreviation: 'kjv', lang: 'en', language: 'English', direction: 'LTR',
    books: [
      { nr: 1, name: 'Genesis', chapters: [{ chapter: 1, verses: [{ chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth. ' }, { chapter: 1, verse: 2, text: 'And the earth was without form.' }] }] },
      { nr: 67, name: 'Tobit', chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'x' }] }] },
    ],
  });
  assert.equal(sniff(file, 'kjv.json')[0].id, 'getbible');
  assert.deepEqual(describe(file, 'getbible', 'kjv.json'), { name: 'King James Version', identify: 'kjv', language: 'en' });
  const { raw, report } = convert({ text: file, format: 'getbible', source: 'kjv.json', category, info: { identify: 'gb-kjv' } });
  assert.equal(report.skipped, 1, 'the book past 66 is counted, not dropped quietly');
  const parsed = parseTranslation(raw, { identify: 'gb-kjv', category });
  assert.equal(parsed.chapters[0].verses[1].text, 'In the beginning God created the heaven and the earth.');
  assert.equal(parsed.meta.info.name, 'King James Version');
});

test('what is already here, under this name or another', () => {
  const held = [
    { identify: 'kjv1611', info: { name: 'King James Version', language: { name: 'eng', iso: { '639-1': 'en' } } } },
    { identify: 'gb-aleppo', info: { name: 'Aleppo Codex', language: { name: 'he', iso: { '639-1': 'he' } } } },
  ];
  const row = (identify, name, code) => ({ identify, name, language: { code } });
  assert.deepEqual(onDevice(row('gb-aleppo', 'Aleppo Codex', 'he'), held), { exact: true, same: null });
  assert.equal(onDevice(row('eb-engkjv', 'The King James Version (1769)', 'eng'), held).same?.identify, 'kjv1611', 'the same Bible from another source');
  assert.equal(onDevice(row('gb-kjv', 'King James Version', 'nb'), held).same, null, 'another language is another translation');
  assert.equal(normalName('The King James Version, 1611'), 'king james version');
});
