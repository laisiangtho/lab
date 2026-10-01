import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { readOsisRef, readStudyFile, sniffStudy, termKey, topicsByVerse } from '../../app/core/studydata.js';
import { root } from '../helpers.js';

const fixture = (name) => readFileSync(root(`test/fixtures/studydata/${name}`), 'utf8');

test('OSIS references as the five numbers kept', () => {
  assert.deepEqual(readOsisRef('Gen.1.1'), [1, 1, 1, 1, 1]);
  assert.deepEqual(readOsisRef('Rom.1.19-Rom.1.20'), [45, 1, 19, 1, 20]);
  assert.deepEqual(readOsisRef('Bible:Exod.4.27-Exod.4.30'), [2, 4, 27, 4, 30]);
  assert.deepEqual(readOsisRef('Bible:Lev.8'), [3, 8, 0, 8, 0], 'a whole chapter is verse 0');
  assert.deepEqual(readOsisRef('Ps.119.1-Ps.120.2'), [19, 119, 1, 120, 2], 'a range across chapters');
  assert.equal(readOsisRef('Tob.1.1'), null, 'a book outside the canon');
});

test('OpenBible.info cross-references, as published', () => {
  const text = fixture('openbible-gen1-1-5.txt');
  assert.deepEqual(sniffStudy(text), { format: 'openbible', type: 'crossrefs' });
  const read = readStudyFile(text, { source: 'cross_references.txt' });
  assert.equal(read.type, 'crossrefs');
  assert.equal(read.count, 112);
  assert.match(read.source, /OpenBible\.info/);
  assert.match(read.licence, /CC BY/);
  const gen1 = read.links['1.1'];
  assert.ok(gen1.length === 112, 'all filed under Genesis 1');
  // Genesis 1:1 → Proverbs 8:22–30, 71 votes.
  assert.ok(gen1.some((link) => JSON.stringify(link) === JSON.stringify([1, 20, 8, 22, 8, 30, 71])));
  assert.ok(gen1.some((link) => link[6] < 0), 'a link voted down is kept, with its votes');
});

test('a cross-reference line that cannot be read is refused by its line number', () => {
  assert.throws(() => readStudyFile('From Verse\tTo Verse\tVotes\nGen.1.1\tRom.1.1\tmany\n', { source: 'x.txt' }), /line 2.*not a number/);
  assert.throws(() => readStudyFile('From Verse\tTo Verse\tVotes\n???\t\t\n', { source: 'x.txt' }), /line 2.*cannot read/);
});

test("Easton's in CCEL's ThML is a dictionary, its references marked", () => {
  const text = fixture('easton-a-extract.xml');
  const read = readStudyFile(text, { source: 'easton_ebd2.xml' });
  assert.equal(read.type, 'dictionary', 'articles, so a dictionary');
  assert.equal(read.name, "Easton's Bible Dictionary");
  assert.match(read.source, /1897/);
  assert.equal(read.count, 6);
  const aaron = read.entries.find((entry) => entry.term === 'Aaron');
  const first = aaron.body[0];
  assert.match(first[0], /^The eldest son of Amram and Jochebed/);
  assert.deepEqual(first[1], { r: [2, 6, 20, 6, 20], t: 'Ex. 6:20' });
  const text0 = read.entries[0].body.flat().map((seg) => (typeof seg === 'string' ? seg : seg.t)).join('');
  assert.match(text0, /Rev\. 1:8, 11; 21:6;/, 'the words around the references keep their spacing');
  assert.doesNotMatch(JSON.stringify(read.entries), /<[a-z]/i, 'no markup left');
});

test('the same ThML read as a topical index', () => {
  const read = readStudyFile(fixture('easton-a-extract.xml'), { source: 'easton', type: 'topics' });
  assert.equal(read.type, 'topics');
  const aaron = read.entries.find((entry) => entry.term === 'Aaron');
  assert.ok(aaron.refs.length > 20);
  assert.ok(aaron.note.length <= 400);
  const byVerse = topicsByVerse(read.entries);
  assert.ok(byVerse.get('2.6.20').has(read.entries.indexOf(aaron)), 'Exodus 6:20 is filed under Aaron');
  assert.throws(() => readStudyFile(fixture('easton-a-extract.xml'), { source: 'easton', type: 'crossrefs' }), /not a cross-reference list/);
});

test('what is not study data is refused, by name', () => {
  assert.equal(sniffStudy('<osis></osis>'), null);
  assert.throws(() => readStudyFile('hello', { source: 'notes.txt' }), /notes\.txt.*not study data/);
});

test('terms are looked up without case or accents', () => {
  assert.equal(termKey('Abaddon'), termKey('ABADDON'));
  assert.equal(termKey('Élohim'), 'elohim');
});

test('a kept reference, as a link and as text', async () => {
  const { refOf, refText } = await import('../../app/core/studydata.js');
  assert.deepEqual(refOf([1, 1, 3, 1, 5]), { book: 1, chapter: 1, verse: 3, endBook: 1, endChapter: 1, endVerse: 5 });
  assert.equal(refText([1, 1, 3, 1, 3], 'Gen'), 'Gen 1:3');
  assert.equal(refText([1, 1, 3, 1, 5], 'Gen'), 'Gen 1:3–5');
  assert.equal(refText([1, 1, 31, 2, 3], 'Gen'), 'Gen 1:31–2:3');
  assert.equal(refText([1, 2, 0, 2, 0], 'Gen'), 'Gen 2');
  assert.equal(refText([1, 1, 3, 1, 5], 'ကမ္ဘာ', (n) => String(n).replace(/\d/g, (d) => '၀၁၂၃၄၅၆၇၈၉'[d])), 'ကမ္ဘာ ၁:၃–၅');
});

test('the app\'s own JSON reads back as what was read', async () => {
  const { readFileSync } = await import('node:fs');
  const { readStudyFile, toStudyJson } = await import('../../app/core/studydata.js');
  const fixtureText = (name) => readFileSync(new URL(`../fixtures/studydata/${name}`, import.meta.url), 'utf8');
  for (const [name, type] of [['openbible-gen1-1-5.txt', 'crossrefs'], ['easton-a-extract.xml', 'dictionary'], ['topics-thml.xml', 'topics']]) {
    const read = readStudyFile(fixtureText(name), { source: name, type });
    const again = readStudyFile(JSON.stringify(toStudyJson(read, { changes: 'test' })), { source: 'copy.json' });
    assert.equal(again.type, type);
    assert.equal(again.count, read.count, name);
    assert.deepEqual(again.links ?? again.entries, read.links ?? read.entries, name);
    assert.equal(again.licence, read.licence);
  }
});

test('scripts/studydata.mjs: a dry run writes nothing, and a wrong type is an error', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = new URL('../../scripts/studydata.mjs', import.meta.url).pathname;
  const fixturePath = new URL('../fixtures/studydata/easton-a-extract.xml', import.meta.url).pathname;
  const out = execFileSync(process.execPath, [script, fixturePath, '--id', 'easton'], { encoding: 'utf8' });
  assert.match(out, /6 entries/);
  assert.match(out, /dry run: nothing written/);
  assert.throws(() => execFileSync(process.execPath, [script, fixturePath, '--id', 'easton', '--type', 'topics'], { stdio: 'pipe' }), /reads easton as dictionary/);
});
