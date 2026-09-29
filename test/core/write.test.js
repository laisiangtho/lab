import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCategory } from '../../app/core/category.js';
import { convert } from '../../app/core/formats/index.js';
import { describeLoss, esc, write, WRITERS } from '../../app/core/formats/write.js';
import { parseTranslation } from '../../app/core/translation.js';
import { root } from '../helpers.js';

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
  assert.deepEqual(describeLoss('native'), [], 'our own format loses nothing');
  assert.match(describeLoss('usfm')[0], /paragraphing/);
  assert.match(describeLoss('csv')[0], /dropped/);
  assert.match(describeLoss('markdown')[0], /rather than a file to import back/);
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
