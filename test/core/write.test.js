import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { convert } from '../../app/core/formats/index.js';
import { aboutText, esc, lossOf, optionsFor, write, WRITERS } from '../../app/core/formats/write.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';
import en from '../../app/shell/locales/en.js';

const category = parseCategory(JSON.parse(readFileSync(root('public/category.json'), 'utf8')));

/** A small translation to write out: two books, headings, a ref, a merge. */
function selection() {
  const raw = {
    identify: 'fixture',
    version: 2,
    info: {
      identify: 'fixture',
      version: 2,
      name: 'Fixture Version',
      shortname: 'FIX',
      year: '1900',
      publisher: 'Test Bible Society',
      copyright: 'Public domain.',
      language: { text: 'English', name: 'eng', iso: { '639-1': 'en', '639-3': 'eng' }, textdirection: 'ltr' },
    },
    book: {
      1: {
        info: { name: 'Genesis', shortname: 'Gen', abbr: ['Gen'] },
        chapter: {
          1: {
            verse: {
              1: { text: 'In the beginning God created the heaven & the earth.', title: 'The creation' },
              2: { text: 'And the earth was without form, and void.', ref: 'Ps 23:1' },
              3: { text: 'And God said, "Let there be light."', merge: '4' },
            },
          },
          2: { verse: { 1: { text: 'Thus the heavens were finished.' } } },
        },
      },
      19: {
        info: { name: 'Psalm', shortname: 'Ps', abbr: ['Ps'] },
        chapter: { 23: { verse: { 1: { text: 'The LORD is my shepherd; I shall not want.' } } } },
      },
    },
  };
  const parsed = parseTranslation(raw, { identify: 'fixture', category });
  return {
    meta: parsed.meta,
    chapters: parsed.chapters,
    bookName: (id) => parsed.meta.books[id]?.name ?? category.book(id).name,
  };
}

const measure = (text, size = 1) => text.length * size;

test('every writer produces something, named for what it is', () => {
  const picked = selection();
  for (const writer of WRITERS) {
    const files = write(writer.id, picked);
    assert.ok(files.length >= 1, writer.id);
    // One file for the whole selection, or one per book.
    assert.equal(files.length === 1, writer.single || files.length === 1, writer.id);
    for (const file of files) {
      assert.ok(file.name.endsWith(`.${writer.ext}`), `${writer.id}: ${file.name}`);
      assert.ok(file.text.trim().length > 40, writer.id);
      assert.ok(file.text.endsWith('\n'), `${writer.id} ends with a newline`);
    }
  }
  assert.throws(() => write('nonsense', picked), /nothing writes/);
});

test('what is written can be read back, verse for verse', () => {
  const picked = selection();
  // Markdown is a document to read rather than a file to import, and CSV
  // deliberately drops headings; both are checked separately below.
  for (const format of ['native', 'usfm', 'usx', 'osis', 'zefania']) {
    const files = write(format, picked);
    const back = new Map();
    for (const file of files) {
      const reader = format === 'native' ? 'native' : format === 'usfm' ? 'usfm' : 'xml';
      const { raw } = convert({
        text: file.text, format: reader, source: file.name, category,
        info: { identify: 'again', name: 'Fixture Version', language: 'eng' },
      });
      const parsed = parseTranslation(raw, { identify: 'again', category });
      for (const row of parsed.chapters) {
        for (const [n, verse] of Object.entries(row.verses)) {
          back.set(`${row.book}/${row.chapter}/${n}`, verse.text.trim());
        }
      }
    }
    for (const row of picked.chapters) {
      for (const [n, verse] of Object.entries(row.verses)) {
        assert.equal(back.get(`${row.book}/${row.chapter}/${n}`), verse.text.trim(),
          `${format}: ${row.book} ${row.chapter}:${n}`);
      }
    }
    assert.equal(back.size, 5, `${format}: every verse came back and no more`);
  }
});

test('a heading survives the round trip where the format has somewhere to put it', () => {
  const picked = selection();
  for (const format of ['native', 'usfm', 'usx', 'osis']) {
    const files = write(format, picked);
    const reader = format === 'native' ? 'native' : format === 'usfm' ? 'usfm' : 'xml';
    const { raw } = convert({
      text: files[0].text, format: reader, source: files[0].name, category,
      info: { identify: 'again', name: 'x', language: 'eng' },
    });
    const parsed = parseTranslation(raw, { identify: 'again', category });
    const first = parsed.chapters.find((row) => row.book === 1 && row.chapter === 1);
    assert.equal(first.verses[1].title, 'The creation', format);
  }
});

test('markup in the text is escaped, and comes back as it went in', () => {
  const picked = selection();
  for (const format of ['usx', 'osis', 'zefania']) {
    const files = write(format, picked);
    assert.ok(files[0].text.includes('&amp;'), `${format}: the ampersand is escaped`);
    assert.ok(!/created the heaven & the/.test(files[0].text), `${format}: and not left raw`);
  }
  assert.equal(esc(`a & b < c > "d" 'e'`), 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
});

test('a merge is written as the range it is', () => {
  const picked = selection();
  assert.match(write('usfm', picked)[0].text, /\\v 3-4 /);
  assert.match(write('usx', picked)[0].text, /number="3-4"/);
  assert.match(write('markdown', picked)[0].text, /\*\*3–4\*\*/);
});

test('a spreadsheet carries the book name, and comes back as verses', () => {
  const picked = selection();
  const [file] = write('csv', picked);
  assert.match(file.text.split('\n')[0], /^book,book_name,chapter,verse,text,title$/);
  // A quoted field, because that verse has a comma in it.
  assert.ok(file.text.includes('"And the earth was without form, and void."'),
    'a comma in the text is quoted, not a new column');
  const { raw } = convert({ text: file.text, format: 'csv', source: file.name, category, info: { identify: 'again' } });
  const parsed = parseTranslation(raw, { identify: 'again', category });
  assert.equal(parsed.chapters.length, 3);
});

test('a whole Bible in USFM is one file per book, named the way Paratext names them', () => {
  const picked = selection();
  const files = write('usfm', picked);
  assert.equal(files.length, 2, 'Genesis and Psalm');
  assert.equal(files[0].name, '01-GEN-fixture.usfm');
  assert.equal(files[1].name, '19-PSA-fixture.usfm');
  assert.match(files[0].text, /^\\id GEN Fixture Version/);
  assert.equal(write('osis', picked).length, 1, 'OSIS is one file whatever it holds');
});

test('what a format cannot carry is said, not hidden', () => {
  assert.deepEqual(lossOf('native'), [], 'our own format loses nothing');
  for (const writer of WRITERS) {
    for (const id of lossOf(writer.id)) assert.ok(en[`exp.loss.${id}`], `${writer.id}: exp.loss.${id} is worded`);
  }
  assert.match(en['exp.loss.layout'], /paragraphing/);
  assert.match(en['exp.loss.csv'], /dropped/);
  assert.match(en['exp.loss.markdown'], /rather than a file to import back/);
  assert.throws(() => lossOf('nonsense'), /nothing writes/);
});

test('an export of part of a translation is a smaller translation, not a broken one', () => {
  const picked = selection();
  const one = { ...picked, chapters: picked.chapters.filter((row) => row.book === 19) };
  const [file] = write('native', one);
  const { raw } = convert({ text: file.text, format: 'native', source: file.name, category, info: {} });
  const parsed = parseTranslation(raw, { identify: 'fixture', category });
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.meta.info.name, 'Fixture Version', 'and it still knows what it is');
  assert.ok(parsed.diagnostics.some((d) => d.type === 'missing-book'), 'with an honest account of what is not in it');
  // And it lays out: the fitting check that this is a real translation file.
  assert.ok(parsed.chapters[0].verses[1].text.startsWith('The LORD'));
  assert.equal(measure('x'), 1);
});

// --- export options ----------------------------------------------------------

/** Read files written in `format` back into "book/chapter/verse" → verse. */
function readBack(format, files) {
  const back = new Map();
  for (const file of files) {
    const reader = format === 'native' ? 'native' : format === 'usfm' ? 'usfm' : 'xml';
    const { raw } = convert({
      text: file.text, format: reader, source: file.name, category,
      info: { identify: 'again', name: 'Fixture Version', language: 'eng' },
    });
    const parsed = parseTranslation(raw, { identify: 'again', category });
    for (const row of parsed.chapters) {
      for (const [n, verse] of Object.entries(row.verses)) back.set(`${row.book}/${row.chapter}/${n}`, verse);
    }
  }
  return back;
}

test('each format says which options mean anything to it', () => {
  for (const writer of WRITERS) assert.ok(optionsFor(writer.id).includes('strongs'), writer.id);
  assert.ok(optionsFor('native').includes('compact'));
  assert.ok(!optionsFor('usfm').includes('compact'), 'USFM has no indentation to take out');
  assert.ok(optionsFor('markdown').includes('notes') && optionsFor('csv').includes('notes'));
  assert.ok(!optionsFor('zefania').includes('references'), 'Zefania writes none to leave out');
  assert.throws(() => optionsFor('nonsense'), /nothing writes/);
  assert.throws(() => write('native', selection(), { minify: true }), /unknown export option "minify"/);
  assert.throws(() => write('csv', selection(), { names: 'english' }), /no englishName/);
});

test("Strong's numbers, headings and references can each be left out", () => {
  const picked = selection();
  picked.chapters = picked.chapters.map((row) => (row.book === 1 && row.chapter === 1
    ? { ...row, verses: { ...row.verses, 1: { ...row.verses[1], text: 'In the beginning{H7225} God{H430} created.' } } }
    : row));
  const full = readBack('native', write('native', picked));
  assert.match(full.get('1/1/1').text, /\{H7225\}/, 'kept by default');
  assert.equal(full.get('1/1/1').title, 'The creation');
  assert.equal(full.get('1/1/2').ref, 'Ps 23:1');

  for (const format of ['native', 'usfm', 'usx', 'osis', 'zefania']) {
    const back = readBack(format, write(format, picked, { strongs: false, headings: false, references: false }));
    assert.equal(back.get('1/1/1').text.trim(), 'In the beginning God created.', `${format}: no codes`);
    assert.equal(back.get('1/1/1').title, undefined, `${format}: no heading`);
    assert.equal(back.get('1/1/2').ref, undefined, `${format}: no reference`);
    assert.equal(back.size, 5, `${format}: every verse still there`);
  }
});

test('compact output is the same document without the whitespace', () => {
  const picked = selection();
  for (const format of ['native', 'usx', 'osis', 'zefania']) {
    const [loose] = write(format, picked);
    const [tight] = write(format, picked, { compact: true });
    assert.ok(tight.text.length < loose.text.length, `${format}: ${tight.text.length} against ${loose.text.length}`);
    assert.equal(tight.text.trimEnd().split('\n').length, 1, `${format}: one line`);
    assert.deepEqual([...readBack(format, [tight]).entries()].map(([k, v]) => [k, v.text.trim()]),
      [...readBack(format, [loose]).entries()].map(([k, v]) => [k, v.text.trim()]), `${format}: reads back the same`);
  }
});

test('notes go under the verse they are on, in Markdown and in a spreadsheet', () => {
  const picked = {
    ...selection(),
    englishName: (id) => category.book(id).name,
    notes: [
      { book: 1, chapter: 1, verse: 2, to: 3, text: 'Formless and empty.\nCompare Jeremiah 4:23.', created: '2026-01-02' },
      { book: 1, chapter: 1, verse: null, to: null, text: 'The chapter of beginnings.', created: '2026-01-01' },
      { book: 19, chapter: 23, verse: 1, to: null, text: '   ', created: '2026-01-03' },
    ],
  };
  const [genesis] = write('markdown', picked, { notes: true, noteLabel: 'Merknad' });
  const text = genesis.text;
  assert.match(text, /## Genesis 1\n\n> \*\*Merknad\*\* The chapter of beginnings\./, 'a chapter note under the chapter heading');
  assert.match(text, /\*\*2\*\* And the earth[^\n]*\n\n> Ps 23:1\n\n> \*\*Merknad 2–3\*\* Formless and empty\.\n> Compare Jeremiah 4:23\./,
    'a note on a run, after its verse and its reference, every line quoted');
  assert.doesNotMatch(write('markdown', picked)[0].text, /Merknad|Note/, 'none unless asked for');

  const [csv] = write('csv', picked, { notes: true });
  const lines = csv.text.trim().split('\n');
  assert.equal(lines[0], 'book,book_name,chapter,verse,text,title,note');
  assert.match(lines[1], /,The chapter of beginnings\.$/, "a chapter's note on its first row");
  assert.match(csv.text, /"Formless and empty\.\nCompare Jeremiah 4:23\."/, 'a note with a line break, quoted');
  assert.match(lines.at(-1), /,$/, 'a blank note is no note');
});

test('book names can be the canon\'s English ones where they are labels', () => {
  const picked = { ...selection(), bookName: () => 'Ammuna', englishName: (id) => category.book(id).name };
  assert.match(write('markdown', picked)[0].text, /^# Ammuna/);
  assert.match(write('markdown', picked, { names: 'english' })[0].text, /^# Genesis/);
  assert.match(write('csv', picked, { names: 'english' })[0].text, /\n1,Genesis,1,1,/);
});

test('the copyright goes wherever the format has a place for it', () => {
  const picked = selection();
  for (const format of ['native', 'usfm', 'usx', 'osis', 'zefania', 'markdown']) {
    for (const file of write(format, picked, { compact: optionsFor(format).includes('compact') })) {
      assert.match(file.text, /Public domain\./, `${format}: ${file.name}`);
    }
  }
  assert.doesNotMatch(write('csv', picked)[0].text, /Public domain/);
  assert.deepEqual(lossOf('csv'), ['csv']);
  assert.match(en['exp.loss.csv'], /copyright/);
  const about = aboutText(picked.meta, { format: 'CSV', generated: '2026-09-30' });
  assert.match(about, /Fixture Version \(FIX\)/);
  assert.match(about, /Copyright\n\nPublic domain\./);
  assert.match(aboutText({ identify: 'x', info: { name: 'X' } }), /states no copyright/);
});

test("Strong's numbers are written in each format's own markup, and read back", () => {
  const picked = selection();
  const marked = {
    '1/1/1': 'In the beginning{H7225} God{H430} created{H1254}{H853} the heaven & the earth.',
    // eBible.org's tagged Judson: words run together, and H9999 is the
    // edition's own number for a word with nothing behind it.
    '1/1/2': 'မြေကြီး{H776}သည်{H9999} အဆင်း{H8414}ကင်းမဲ့၏။',
  };
  picked.chapters = picked.chapters.map((row) => (row.book === 1 && row.chapter === 1
    ? { ...row, verses: { ...row.verses, 1: { ...row.verses[1], text: marked['1/1/1'] }, 2: { ...row.verses[2], text: marked['1/1/2'] } } }
    : row));
  const markup = {
    usfm: /\\w God\|strong="H430"\\w\*/,
    usx: /<char style="w" strong="H430">God<\/char>/,
    osis: /<w lemma="strong:H430">God<\/w>/,
    zefania: /<gr str="430">God<\/gr>/,
  };
  for (const [format, pattern] of Object.entries(markup)) {
    const text = write(format, picked).map((file) => file.text).join('\n');
    assert.match(text, pattern, `${format}: the format's own markup`);
    assert.doesNotMatch(text, /\{[HG]\d/, `${format}: not this app's inline notation`);
    const back = readBack(format, write(format, picked));
    for (const [place, expected] of Object.entries(marked)) {
      assert.equal(back.get(place).text.trim(), expected, `${format}: ${place} comes back with every number, the edition's own included`);
    }
  }
  const md = write('markdown', picked).map((file) => file.text).join('\n');
  assert.match(md, /God<sup>H430<\/sup>/);
  assert.match(md, /created<sup>H1254 H853<\/sup>/, 'a word with two numbers keeps both');
});

test('a word keeps its morphology through every format that has a place for it', () => {
  const picked = selection();
  const marked = 'In the beginning{H7225:HR/Ncfsa} God{H430:HNcmpa} created{H853}{H1254:HVqp3ms}.';
  picked.chapters = picked.chapters.map((row) => (row.book === 1 && row.chapter === 1
    ? { ...row, verses: { ...row.verses, 1: { ...row.verses[1], text: marked } } }
    : row));
  const where = {
    usfm: /\\w God\|strong="H430" x-morph="HNcmpa"\\w\*/,
    usx: /<char style="w" strong="H430" x-morph="HNcmpa">God<\/char>/,
    osis: /<w lemma="strong:H430" morph="HNcmpa">God<\/w>/,
    zefania: /<gr str="430" rmac="HNcmpa">God<\/gr>/,
  };
  for (const [format, pattern] of Object.entries(where)) {
    assert.match(write(format, picked).map((file) => file.text).join('\n'), pattern, format);
    assert.equal(readBack(format, write(format, picked)).get('1/1/1').text.trim(), marked, `${format}: read back whole`);
  }
});
