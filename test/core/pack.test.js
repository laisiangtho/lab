import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { readBookNames, readMetadata, readPack } from '../../app/core/formats/pack.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));

/** A bundle shaped like the one eBible.org hands out. */
const BUNDLE = [
  {
    name: 'engkjvcpb_usfx.xml',
    text: `<usfx><book id="GEN"><c id="1"/>
      <v id="1"/>In the <w s="H7225">beginning</w> God <w s="H1254">created</w> the heaven.<ve/>
      <v id="2"/>And the earth was without form.<f>a footnote</f><ve/></book>
      <book id="PSA"><c id="23"/><s>A Psalm of David</s>
      <v id="1"/>The LORD is my shepherd.<ve/></book></usfx>`,
  },
  {
    name: 'BookNames.xml',
    text: `<BookNames>
      <book code="GEN" abbr="Gen" short="Genesis" long="The First Book of Moses, called Genesis"/>
      <book code="PSA" abbr="Ps" short="Psalms" long="The Book of Psalms"/>
      <book code="ZZZ" abbr="X" short="Nowhere"/>
    </BookNames>`,
  },
  {
    name: 'engkjvcpbmetadata.xml',
    text: `<DBLMetadata id="abc" revision="3">
      <identification>
        <name>KJV Cambridge Paragraph Bible</name>
        <abbreviation>KJVCPB</abbreviation>
      </identification>
      <language><iso>eng</iso><name>English</name><scriptDirection>LTR</scriptDirection></language>
      <copyright><fullStatement><p>Public domain.</p></fullStatement></copyright>
    </DBLMetadata>`,
  },
  { name: 'copr.htm', text: '<html><body><p>Public domain &amp; freely given.</p></body></html>' },
  { name: 'dejavuserif.css', text: 'body { font-family: serif; }' },
  { name: 'keys.asc', text: '-----BEGIN PGP PUBLIC KEY BLOCK-----' },
];

test('a published bundle is taken whole, not one file out of eight', () => {
  const { raw, report } = readPack(BUNDLE, { category, source: 'engkjvcpb_usfx.zip', info: { identify: 'engkjvcpb' } });
  assert.equal(report.format, 'xml');
  assert.equal(report.books, 2);
  assert.equal(report.verses, 3);

  // The metadata file names it, so the reader does not have to.
  assert.equal(raw.info.name, 'KJV Cambridge Paragraph Bible');
  assert.equal(raw.info.shortname, 'KJVCPB');
  assert.equal(raw.info.language, 'eng');
  assert.equal(raw.info.textdirection, 'ltr');
  assert.match(raw.info.copyright, /Public domain/);

  // And the files that an import has no use for are listed, not ignored.
  assert.deepEqual(report.skipped, ['dejavuserif.css', 'keys.asc']);
});

test('the translation\'s own book names come with it', () => {
  const { raw, report } = readPack(BUNDLE, { category, info: { identify: 'x' } });
  assert.equal(report.named, 2, 'two of the three matched a book in the canon');
  assert.equal(raw.book[1].info.name, 'Genesis');
  assert.deepEqual(raw.book[1].info.abbr, ['Gen', 'Genesis', 'The First Book of Moses, called Genesis']);
  assert.equal(raw.book[19].info.name, 'Psalms');
});

test('Strong\'s numbers survive the journey, and footnotes do not', () => {
  const { raw, report } = readPack(BUNDLE, { category, info: { identify: 'x' } });
  assert.equal(raw.book[1].chapter[1].verse[1].text.trim(),
    'In the beginning{H7225} God created{H1254} the heaven.');
  assert.equal(report.strongs, 1, 'one verse carries numbers');
  assert.ok(!JSON.stringify(raw.book).includes('a footnote'), 'a note is not scripture');
  assert.equal(raw.book[19].chapter[23].verse[1].title, 'A Psalm of David');
});

test('what comes out of a bundle is a translation the strict parser reads', () => {
  const { raw } = readPack(BUNDLE, { category, info: { identify: 'engkjvcpb' } });
  const parsed = parseTranslation({ ...raw, info: { ...raw.info, language: undefined, ...languageOf(raw) } },
    { identify: 'engkjvcpb', category });
  assert.equal(parsed.meta.info.name, 'KJV Cambridge Paragraph Bible');
  assert.equal(parsed.stats.verses, 3);
  assert.ok(parsed.diagnostics.some((d) => d.type === 'missing-book'));
});

/** The language block a bundle's flat `language: "eng"` has to become. */
function languageOf(raw) {
  return {
    language: {
      text: raw.info.languageText ?? 'English',
      name: raw.info.language,
      iso: { '639-1': '', '639-3': raw.info.language },
      textdirection: raw.info.textdirection ?? 'ltr',
    },
  };
}

test('a bundle of one file per book is merged, not fought over', () => {
  const usfm = [
    { name: '01-GENkjv.usfm', text: '\\id GEN\n\\c 1\n\\v 1 In the beginning.\n' },
    { name: '19-PSAkjv.usfm', text: '\\id PSA\n\\c 23\n\\v 1 The LORD is my shepherd.\n' },
    { name: '19-PSAkjv-b.usfm', text: '\\id PSA\n\\c 24\n\\v 1 The earth is the LORD\\u2019s.\n' },
  ];
  const { raw, report } = readPack(usfm, { category, info: { identify: 'kjv' } });
  assert.equal(report.format, 'usfm');
  assert.equal(report.files, 3);
  assert.equal(report.books, 2, 'two books out of three files');
  assert.ok(raw.book[19].chapter[23], 'and the second Psalms file did not replace the first');
  assert.ok(raw.book[19].chapter[24]);
});

test('an archive with no scripture in it says so', () => {
  assert.throws(() => readPack([
    { name: 'readme.txt', text: 'Nothing here.' },
    { name: 'logo.png', text: 'PNG' },
  ], { category, source: 'empty.zip' }), /no scripture file/);
});

test('the metadata reader takes the paragraph it needs and leaves the document', () => {
  const found = readMetadata(`<DBLMetadata>
    <identification><name>A Bible</name><nameLocal>ဘာသာပြန်</nameLocal><abbreviation>AB</abbreviation></identification>
    <language><iso>mya</iso><name>Burmese</name><scriptDirection>LTR</scriptDirection></language>
    <copyright><fullStatement><p>© 1999 <b>Someone</b>.</p></fullStatement></copyright>
    <agencies><etenPartner>Nobody</etenPartner></agencies>
  </DBLMetadata>`);
  assert.equal(found.name, 'A Bible', 'the first name wins, not the last element with that tag');
  assert.equal(found.shortname, 'AB');
  assert.equal(found.language, 'mya');
  assert.equal(found.copyright, '© 1999 Someone .', 'markup out, text in');
  assert.equal(found.etenPartner, undefined, 'and nothing this app has nowhere to put');
});

test('book names are matched by their standard code, and an unknown one is passed over', () => {
  const found = readBookNames('<BookNames><book code="1CO" abbr="1Co" short="1 Corinthians"/><book code="NOPE" short="x"/></BookNames>');
  assert.equal(found[46].name, '1 Corinthians');
  assert.equal(Object.keys(found).length, 1);
});

test('eBible.org downloads that are not the data are named, with the one to take instead', async () => {
  const { otherEdition, readPack } = await import('../../app/core/formats/pack.js');
  const readaloud = [
    { name: 'myajvb_002_GEN_01_read.txt', text: 'အစအဦး၌ ဘုရားသခင်သည် ကောင်းကင်နှင့် မြေကြီးကို ဖန်ဆင်းတော်မူ၏။' },
    { name: 'myajvb_002_GEN_02_read.txt', text: '…' },
  ];
  assert.deepEqual(otherEdition(readaloud, 'download.zip'), { kind: 'readaloud', id: 'myajvb', instead: 'myajvb_usfx.zip' }, 'known by its files alone');
  assert.equal(otherEdition([], 'myajvb_browserBible.zip').kind, 'browserbible');
  assert.equal(otherEdition([{ name: 'info.json', text: '{}' }, ...['GN1', 'GN2', 'GN3', 'EX1', 'EX2'].map((n) => ({ name: `${n}.html`, text: '<p/>' }))], 'x.zip').kind, 'browserbible');
  assert.equal(otherEdition([], 'myajvb_html.zip').instead, 'myajvb_usfx.zip');
  assert.equal(otherEdition([{ name: 'myajvb_usfx.xml', text: '<usfx/>' }], 'myajvb_usfx.zip'), null, 'the data is not another edition');
  assert.throws(() => readPack(readaloud, { category, source: 'myajvb_readaloud.zip' }), /read-?aloud.*take myajvb_usfx\.zip instead/i);
});
