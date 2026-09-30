/**
 * What the import dialog is filled with, and the language an imported file is
 * given — found wrong on a real OSIS file (bhs.xml): no name, although its
 * header carries one, and Hebrew laid out left to right.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCategory } from '../app/core/category.js';
import { convert, describe } from '../app/core/formats/index.js';
import { directionOf } from '../app/core/langcode.js';
import { root } from './helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));
const BHS = `<?xml version='1.0' encoding='UTF-8'?>
<osis xmlns='http://www.bibletechnologies.net/2003/OSIS/namespace'>
  <osisText osisRefWork='Bible' osisIDWork='bhs' xml:lang='he'>
    <header><work osisWork='bhs'><title>Biblia  hebraica</title><language type='IETF'>he</language>
      <rights>Vous &#234;tes autoris&#233;</rights></work></header>
    <div type='book' osisID='Gen'><chapter osisID='Gen.1'>
      <verse osisID='Gen.1.1'><w lemma='strong:H7225'>בְּרֵאשִׁ֖ית</w> בָּרָ֣א אֱלֹהִ֑ים</verse>
    </chapter></div>
  </osisText>
</osis>`;

test('an OSIS file is named from its header title', () => {
  assert.deepEqual(describe(BHS, 'xml', 'bhs.xml'), { name: 'Biblia hebraica', identify: 'bhs', language: 'he' });
  assert.equal(describe('<XMLBIBLE biblename="Luther 1912"><INFORMATION><title>x</title>', 'xml', 'l.xml').name, 'Luther 1912',
    "Zefania's own attribute still comes first");
});

test('a language written right to left is set right to left', () => {
  for (const code of ['he', 'heb', 'ar', 'arb', 'fa', 'ur', 'yi']) assert.equal(directionOf(code), 'rtl', code);
  for (const code of ['en', 'my', 'mya', 'ctd', 'nb', '', 'zzz']) assert.equal(directionOf(code), 'ltr', code || '(none)');
  const { raw } = convert({ text: BHS, format: 'xml', source: 'bhs.xml', category, info: { name: 'Biblia hebraica', language: 'he' } });
  assert.equal(raw.info.language.textdirection, 'rtl');
  assert.equal(raw.info.language.text, 'Hebrew', 'and named, not left as its code');
  assert.match(raw.book[1].chapter[1].verse[1].text, /^בְּרֵאשִׁ֖ית\{H7225\}/);
});
