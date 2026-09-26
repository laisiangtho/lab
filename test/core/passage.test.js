import { strict as assert } from 'node:assert';
import test from 'node:test';

import { toCitation, toMarkdown, toPrintable } from '../../app/core/passage.js';

const passage = {
  reference: 'Psalm 23:1–3',
  translation: 'King James Version',
  lines: [
    { verse: 1, label: '1', text: 'The LORD is my shepherd; I shall not want.' },
    { verse: 2, label: '2', text: 'He maketh me to lie down in green pastures.', marked: true },
    { verse: 3, label: '3', text: 'He restoreth my soul.', title: 'A psalm of David' },
  ],
  notes: [{ label: 'Psalm 23:1', text: 'Shepherd: the same word is used of kings.' }],
};

test('markdown keeps the passage as a quotation with its verse numbers', () => {
  const out = toMarkdown(passage);
  assert.match(out, /^## Psalm 23:1–3\n/);
  assert.match(out, /\*King James Version\*/);
  assert.match(out, /> \*\*1\*\* The LORD is my shepherd/);
  // A marked verse is marked in the output too, in the syntax that survives.
  assert.match(out, /> ==\*\*2\*\*[^\n]*==/);
  assert.match(out, /\*\*A psalm of David\*\*/);
  assert.match(out, /### Note\n/);
  assert.match(out, /Shepherd: the same word/);
  assert.ok(out.endsWith('\n'));
});

test('markdown can leave the numbers and the notes out', () => {
  const out = toMarkdown(passage, { numbers: false, notes: false });
  assert.ok(!out.includes('**1**'));
  assert.ok(!out.includes('Note'));
  assert.match(out, /> The LORD is my shepherd/);
});

test('a citation is one paragraph, with the reference after it', () => {
  const out = toCitation(passage);
  assert.ok(!out.includes('\n'));
  assert.match(out, /^“The LORD is my shepherd/);
  assert.match(out, /2 He maketh me/);
  assert.match(out, /— Psalm 23:1–3 \(King James Version\)$/);
});

test('a single verse is cited without a verse number in the body', () => {
  const out = toCitation({ ...passage, lines: [passage.lines[0]] });
  assert.equal(out, '“The LORD is my shepherd; I shall not want.” — Psalm 23:1–3 (King James Version)');
});

test('the printable sheet is a whole document and escapes what it is given', () => {
  const out = toPrintable({
    ...passage,
    lines: [{ verse: 1, label: '1', text: 'Bread & <wine>' }],
    notes: [{ label: 'n', text: 'first\n\nsecond' }],
  });
  assert.match(out, /^<!doctype html>/);
  assert.match(out, /Bread &amp; &lt;wine&gt;/);
  assert.ok(!out.includes('<wine>'));
  assert.match(out, /<p>first<\/p><p>second<\/p>/);
});
