import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { isBrowserBible, readBrowserBible } from '../../app/core/formats/browserbible.js';
import { otherEdition, readPack } from '../../app/core/formats/pack.js';
import { extractStrongs, plainText } from '../../app/core/strongs.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));
/** A fixture folder as the archive reader hands it over: names and text. */
const folder = (name) => {
  const base = root(`test/fixtures/browserbible/${name}`);
  const files = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const inner of readdirSync(`${base}/${entry.name}`)) files.push({ name: `${name}/${entry.name}/${inner}`, text: readFileSync(`${base}/${entry.name}/${inner}`, 'utf8') });
    } else files.push({ name: `${name}/${entry.name}`, text: readFileSync(`${base}/${entry.name}`, 'utf8') });
  }
  return files;
};
const install = (files, identify) => parseTranslation(readPack(files, { category, source: `${identify}_browserBible.zip`, info: { identify } }).raw, { identify, category });

test('recognised as a text to read, not turned away', () => {
  const files = folder('eng_kjv2006');
  assert.equal(isBrowserBible(files), true);
  assert.equal(otherEdition(files, 'engkjv_browserBible.zip'), null);
});

test('KJV 2006: words tagged with several numbers and Strong\'s tense codes; the search index left aside', () => {
  const files = folder('eng_kjv2006');
  const { raw, report } = readBrowserBible(files, { source: 'kjv' });
  assert.equal(report.indexes, true, 'the index folder was seen and not read');
  assert.equal(raw.info.name, 'King James Version (2006)');
  assert.equal(raw.info.shortname, 'KJV');
  const parsed = install(files, 'kjv2006');
  const gen = parsed.chapters.find((row) => row.book === 1 && row.chapter === 1).verses;
  assert.equal(plainText(gen[1].text), 'In the beginning God created the heaven and the earth.');
  assert.deepEqual(extractStrongs(gen[1].text).codes.map(({ code, morph }) => (morph ? `${code}:${morph}` : code)),
    ['H7225', 'H430', 'H853', 'H1254:strongMorph:TH8804', 'H8064', 'H853', 'H776']);
  assert.equal(Object.keys(gen).length, 31);
  const john = parsed.chapters.find((row) => row.book === 43 && row.chapter === 3).verses;
  assert.match(plainText(john[16].text), /^For God so loved the world/);
  assert.equal(parsed.meta.books[1].name, 'Genesis', 'its own book names');
});

test('WLC: Hebrew right to left, with OpenScriptures morphology', () => {
  const files = folder('heb_wlc');
  const { raw } = readBrowserBible(files, { source: 'wlc' });
  assert.equal(raw.info.language.textdirection, 'rtl');
  const parsed = install(files, 'wlc');
  const verse = parsed.chapters.find((row) => row.book === 1 && row.chapter === 1).verses[1];
  assert.deepEqual(extractStrongs(verse.text).codes.slice(0, 3).map(({ code, morph }) => `${code}:${morph}`),
    ['H7225:HR/Ncfsa', 'H1254:HVqp3ms', 'H430:HNcmpa']);
  assert.ok(plainText(verse.text).normalize('NFC').startsWith('בְּרֵאשִׁ֖ית'.normalize('NFC')), 'starts with the first word, no stray space or slash');
});

test('WEB: a psalm\'s title on verse 1, poetry lines joined, notes left out and counted', () => {
  const files = folder('eng_web');
  const { report } = readBrowserBible(files, { source: 'web' });
  const parsed = install(files, 'web');
  const psalm = parsed.chapters.find((row) => row.book === 19 && row.chapter === 23).verses;
  assert.equal(psalm[1].title, 'A Psalm by David.');
  assert.equal(psalm[1].text, 'Yahweh is my shepherd: I shall lack nothing.', 'two lines of verse 1, one verse');
  assert.equal(Object.keys(psalm).length, 6);
  const matthew = parsed.chapters.find((row) => row.book === 40 && row.chapter === 5).verses;
  assert.equal(Object.keys(matthew).length, 48);
  assert.ok(report.notes > 0, 'footnotes counted');
  assert.ok(Object.values(matthew).every((v) => !/[+*]\s|\bnote\b/.test(v.text) && !/<|&[a-z]+;/.test(v.text)), 'no note keys, markup or entities in the text');
});

test('a language code typed in the import dialog keeps the direction info.json states', () => {
  const files = folder('heb_wlc');
  // As the Library sends it: the dialog's answers, the language a bare code.
  const { raw } = readPack(files, { category, source: 'heb_wlc_browserBible.zip', info: { identify: 'wlc', name: 'WLC', language: 'hbo' } });
  assert.equal(typeof raw.info.language, 'object', 'the block, not the code');
  assert.equal(raw.info.language.name, 'hbo');
  assert.equal(raw.info.language.textdirection, 'rtl');
  assert.equal(typeof raw.info.language.text, 'string');
  const parsed = parseTranslation(raw, { identify: 'wlc', category });
  assert.equal(parsed.meta.info.language.textdirection, 'rtl');
});
