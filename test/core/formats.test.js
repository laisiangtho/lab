import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { bookMatcher } from '../../app/core/formats/books.js';
import { convert, sniff, slug } from '../../app/core/formats/index.js';
import { fromDelimited, splitRow } from '../../app/core/formats/csv.js';
import { fromUsfm } from '../../app/core/formats/usfm.js';
import { fromXml, sniffXml } from '../../app/core/formats/xml.js';
import { decodeEntities, readXml } from '../../app/core/formats/xmlread.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));

// --- the reader ------------------------------------------------------------

test('the xml reader reports tags, attributes and text, and skips the rest', () => {
  const events = [];
  readXml(`<?xml version="1.0"?><!DOCTYPE bible [<!ENTITY x "y">]>
    <b n="1" say='hi'><!-- a comment --><v>one &amp; <![CDATA[two < three]]></v><e/></b>`,
  (e) => events.push(e));
  const opens = events.filter((e) => e.kind === 'open');
  assert.deepEqual(opens.map((e) => e.name), ['b', 'v', 'e']);
  assert.deepEqual(opens[0].attrs, { n: '1', say: 'hi' });
  assert.equal(opens[2].empty, true);
  assert.equal(events.filter((e) => e.kind === 'text').map((e) => e.text).join('').trim(), 'one & two < three');
  assert.deepEqual(events.filter((e) => e.kind === 'close').map((e) => e.name), ['v', 'b']);
});

test('entities are decoded, and one that means nothing is left alone', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42;'), 'a & b <c> A B');
  assert.equal(decodeEntities('&nonsense; &#999999999;'), '&nonsense; &#999999999;');
});

// --- naming books ----------------------------------------------------------

test('a book is found by its name, its abbreviation, or either standard code', () => {
  const books = bookMatcher(category);
  assert.equal(books.idFor('Genesis'), 1);
  assert.equal(books.idFor('GEN'), 1, 'USFM');
  assert.equal(books.idFor('Gen.1.1'), 1, 'an OSIS reference');
  assert.equal(books.idFor('1CO'), 46, 'USFM, where the abbreviation lists disagree');
  assert.equal(books.idFor('1Cor'), 46, 'OSIS');
  assert.equal(books.idFor('SNG'), 22);
  assert.equal(books.idFor('Song of Solomon'), 22);
  assert.equal(books.idFor('19'), 19, 'a position in the canon');
  assert.equal(books.idFor('  psalms '), 19);
  assert.equal(books.idFor('Book of Mormon'), null, 'no guess for a name it does not know');
  assert.equal(books.idFor(''), null);
  assert.equal(books.usfmFor(66), 'REV');
});

// --- USFM ------------------------------------------------------------------

const USFM_SAMPLE = `\\id GEN Genesis, from a fixture
\\h Genesis
\\toc1 The First Book of Moses
\\mt1 GENESIS
\\c 1
\\s The creation
\\p
\\v 1 In the beginning God created the heaven and the earth.\\f + \\fr 1.1 \\ft A footnote that is not scripture.\\f*
\\v 2 And the earth was without form, and void;
\\q1 and darkness was upon the face of the deep.
\\v 3-4 And God said, Let there be light.\\x - \\xo 1.3 \\xt John 1:1\\x*
\\c 2
\\p
\\v 1 Thus the heavens and the earth were finished.
\\v 2 And on the seventh day God \\add had \\add*ended his work.
\\v 3 And God \\w blessed|strong="H1288"\\w* the seventh day.
`;

test('usfm gives up its chapters, verses and headings, and keeps notes out of the text', () => {
  const { raw, report } = fromUsfm(USFM_SAMPLE, { category, source: 'gen.usfm' });
  const gen = raw.book[1].chapter;
  assert.equal(report.books, 1);
  assert.equal(report.chapters, 2);
  assert.equal(gen[1].verse[1].text, 'In the beginning God created the heaven and the earth.');
  assert.equal(gen[1].verse[1].title, 'The creation', 'a section heading belongs to the verse under it');
  assert.equal(report.notes, 2, 'a footnote and a cross-reference, counted and dropped');
  assert.ok(!JSON.stringify(gen).includes('footnote'), 'and not left in the verse');
  assert.ok(!JSON.stringify(gen).includes('John 1:1'));
  // A line broken for poetry is one verse.
  assert.equal(gen[1].verse[2].text, 'And the earth was without form, and void; and darkness was upon the face of the deep.');
  // A range is read as its first verse; the canon check reports the gap.
  assert.equal(gen[1].verse[3].text, 'And God said, Let there be light.');
  // Character markers are formatting, and their content is the verse.
  assert.equal(gen[2].verse[2].text, 'And on the seventh day God had ended his work.');
  assert.equal(gen[2].verse[3].text, 'And God blessed the seventh day.', 'word tagging is dropped, the word is not');
  assert.equal(raw.info.identify, 'gen');
});

test('usfm with no book says so rather than importing nothing', () => {
  assert.throws(() => fromUsfm('\\c 1\n\\v 1 text', { category, source: 'x.usfm' }), /no book/);
});

// --- XML -------------------------------------------------------------------

const ZEFANIA = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="Fixture Version" type="x-bible">
  <BIBLEBOOK bnumber="1" bname="Genesis">
    <CHAPTER cnumber="1">
      <VERS vnumber="1">In the beginning.</VERS>
      <VERS vnumber="2">And the earth<NOTE>a note</NOTE> was void.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="19" bname="Psalms">
    <CHAPTER cnumber="23"><VERS vnumber="1">The LORD is my shepherd.</VERS></CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>`;

const OSIS = `<osis><osisText osisIDWork="Fixture" xml:lang="en">
  <div type="book" osisID="Gen">
    <title type="section">The creation</title>
    <chapter osisID="Gen.1">
      <verse osisID="Gen.1.1">In the beginning.</verse>
      <verse osisID="Gen.1.2">And the earth<note>a note</note> was void.</verse>
    </chapter>
  </div>
</osisText></osis>`;

const USFX = `<usfx><book id="GEN">
  <c id="1"/>
  <s>The creation</s>
  <v id="1"/>In the beginning.<f>a note</f><ve/>
  <v id="2"/>And the earth was void.<ve/>
  <c id="2"/><v id="1"/>Thus the heavens.<ve/>
</book></usfx>`;

test('the three xml dialects are told apart and read the same way', () => {
  assert.equal(sniffXml(ZEFANIA), 'zefania');
  assert.equal(sniffXml(OSIS), 'osis');
  assert.equal(sniffXml(USFX), 'usfx');
  assert.equal(sniffXml('<html><body>no</body></html>'), null);

  for (const [name, source] of [['zefania', ZEFANIA], ['osis', OSIS], ['usfx', USFX]]) {
    const { raw, report } = fromXml(source, { category, source: `${name}.xml` });
    const gen = raw.book[1].chapter;
    assert.equal(gen[1].verse[1].text.trim(), 'In the beginning.', name);
    assert.match(gen[1].verse[2].text, /And the earth\s*was void\./, `${name}: a note is not the verse`);
    assert.ok(!JSON.stringify(gen).includes('a note'), `${name}: and is nowhere in it`);
    assert.equal(report.dialect, name);
  }
});

test('xml carries what it knows about itself, and titles land on their verse', () => {
  const zef = fromXml(ZEFANIA, { category, source: 'z.xml' });
  assert.equal(zef.raw.info.name, 'Fixture Version');
  assert.equal(zef.raw.book[19].chapter[23].verse[1].text.trim(), 'The LORD is my shepherd.');
  assert.equal(zef.report.books, 2);

  const osis = fromXml(OSIS, { category, source: 'o.xml' });
  assert.equal(osis.raw.info.language, 'en');
  assert.equal(osis.raw.book[1].chapter[1].verse[1].title, 'The creation');

  const usfx = fromXml(USFX, { category, source: 'u.xml' });
  assert.equal(usfx.raw.book[1].chapter[2].verse[1].text.trim(), 'Thus the heavens.');
});

test('xml that is not a Bible is refused by name', () => {
  assert.throws(() => fromXml('<html><p>hello</p></html>', { category, source: 'page.xml' }), /not Zefania, OSIS or USFX/);
});

// --- delimited -------------------------------------------------------------

test('a spreadsheet of verses imports, with or without a header', () => {
  const withHead = 'Book,Chapter,Verse,Text\nGenesis,1,1,"In the beginning, God"\nPsalms,23,1,The LORD is my shepherd\n';
  const one = fromDelimited(withHead, { category, source: 'bible.csv' });
  assert.equal(one.raw.book[1].chapter[1].verse[1].text, 'In the beginning, God', 'a quoted comma is not a column');
  assert.equal(one.raw.book[19].chapter[23].verse[1].text, 'The LORD is my shepherd');

  const bare = '1\t1\t1\tIn the beginning\n1\t1\t2\tAnd the earth\n';
  const two = fromDelimited(bare, { category, source: 'bible.tsv' });
  assert.equal(two.report.delimiter, '\t', 'the delimiter is sniffed, not asked for');
  assert.equal(two.raw.book[1].chapter[1].verse[2].text, 'And the earth');
});

test('rows that are not verses are counted rather than guessed at', () => {
  const messy = 'Book,Chapter,Verse,Text\nGenesis,1,1,Fine\nAtlantis,1,1,Not a book\nGenesis,x,1,Not a chapter\n';
  const out = fromDelimited(messy, { category, source: 'messy.csv' });
  assert.equal(out.report.verses, 1);
  assert.equal(out.report.skipped, 2);
  assert.deepEqual(out.report.unknown, ['Atlantis'], 'and the name it could not place is named');
  assert.throws(() => fromDelimited('a,b\nc,d\n', { category, source: 'no.csv' }), /no rows/);
});

test('a quoted field keeps its quotes and separators', () => {
  assert.deepEqual(splitRow('a,"b,c","say ""hi""",d', ','), ['a', 'b,c', 'say "hi"', 'd']);
});

// --- choosing, and the contract with the validator --------------------------

test('a file is recognised by what is in it, best first', () => {
  assert.equal(sniff(USFM_SAMPLE, 'gen.usfm')[0].id, 'usfm');
  assert.equal(sniff(ZEFANIA, 'bible.xml')[0].id, 'xml');
  assert.equal(sniff('Book,Chapter,Verse,Text\nGenesis,1,1,x\nGenesis,1,2,y\n', 'b.csv')[0].id, 'csv');
  assert.equal(sniff('{"info":{"identify":"kjv"},"book":{}}', 'kjv.json')[0].id, 'native');
  assert.deepEqual(sniff('hello, world', 'notes.md'), [], 'and a file that is none of them says nothing');
});

test('what an adapter produces is what the strict parser already reads', () => {
  const { raw } = convert({
    text: USFM_SAMPLE,
    format: 'usfm',
    source: 'gen.usfm',
    category,
    info: { identify: 'fixture', name: 'Fixture Version', language: 'eng' },
  });
  // The point of the whole design: an imported file goes through the same
  // validator as a file from the catalog, and comes out with the same report.
  const parsed = parseTranslation(raw, { identify: 'fixture', category });
  assert.equal(parsed.meta.info.name, 'Fixture Version');
  assert.equal(parsed.meta.info.language.code, 'en', 'and its language is one the browser knows');
  assert.equal(parsed.chapters.length, 2);
  assert.ok(parsed.diagnostics.some((d) => d.type === 'missing-book'), 'a file of one book says so');
  assert.ok(parsed.diagnostics.some((d) => d.type === 'versification' && d.book === 1));
});

test('an import fills in what a format cannot carry', () => {
  const { raw } = convert({ text: 'Book,Chapter,Verse,Text\nGen,1,1,x\n', format: 'csv', source: 'My Bible (2).csv', category });
  assert.equal(raw.info.identify, 'mybible2', 'a name from the file name');
  assert.equal(raw.info.name, 'mybible2');
  assert.equal(raw.info.language.textdirection, 'ltr');
  assert.equal(slug('KJV-1611.json'), 'kjv1611');
});
