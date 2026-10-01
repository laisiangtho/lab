import { strict as assert } from 'node:assert';
import test from 'node:test';

import { lookup, normalizeKey, parseLexicon, splitCode } from '../../app/core/lexicon.js';

const FILE = {
  app: 'lai-siangtho',
  kind: 'lexicon',
  schema: 1,
  testament: 'H',
  name: "Strong's Hebrew Dictionary",
  source: 'public domain',
  entry: {
    7225: {
      lemma: 'רֵאשִׁית',
      xlit: 'rêʼshîyth',
      pron: 'ray-sheeth\'',
      strongs_def: 'the first, in place, time, order or rank',
      kjv_def: 'beginning, chief(-est), first(-fruits, part, time)',
    },
    // The other shapes the public-domain transcriptions come in.
    H1254: { define: 'to create, shape, form' },
    '0430': 'gods in the ordinary sense',
    '8674a': { definition: 'a variant entry' },
    nonsense: { nothing: 'at all' },
  },
};

const GREEK = {
  app: 'lai-siangtho', kind: 'lexicon', schema: 1, testament: 'G',
  entry: { 5485: { define: 'grace, favour' } },
};

test('a lexicon is read whatever shape its entries came in', () => {
  const held = parseLexicon(FILE, { source: 'strongs-h.json' });
  assert.equal(held.testament, 'H');
  assert.equal(held.name, "Strong's Hebrew Dictionary");
  assert.equal(held.entries['7225'].lemma, 'רֵאשִׁית');
  assert.equal(held.entries['7225'].translit, 'rêʼshîyth', 'xlit is translit');
  assert.match(held.entries['7225'].define, /^the first/);
  assert.match(held.entries['7225'].kjv, /beginning/);
  // The key's letter and its leading zeros are the file's business, not ours.
  assert.ok(held.entries['1254'], 'H1254 filed under 1254');
  assert.equal(held.entries['430'].define, 'gods in the ordinary sense', 'a bare string is a definition');
  assert.ok(held.entries['8674a'], 'a lettered variant keeps its letter');
  assert.equal(held.entries.nonsense, undefined, 'an entry that says nothing is not one');
});

test('a file that is not a lexicon is refused, by name and by place', () => {
  const source = 'f.json';
  assert.throws(() => parseLexicon({ ...FILE, app: 'other' }, { source }), /\$\.app/);
  assert.throws(() => parseLexicon({ ...FILE, kind: 'translation' }, { source }), /\$\.kind/);
  assert.throws(() => parseLexicon({ ...FILE, schema: 9 }, { source }), /schema/);
  assert.throws(() => parseLexicon({ ...FILE, testament: 'X' }, { source }), /\$\.testament/);
  assert.throws(() => parseLexicon({ ...FILE, entry: {} }, { source }), /no entries/);
});

test('a code is normalised however the text spells it', () => {
  assert.equal(normalizeKey('H7225'), '7225');
  assert.equal(normalizeKey('07225'), '7225');
  assert.equal(normalizeKey('g5485'), '5485');
  assert.equal(normalizeKey('8674A'), '8674a');
  assert.equal(normalizeKey('rubbish'), '');
  assert.deepEqual(splitCode('G5485'), { testament: 'G', key: '5485' });
  assert.deepEqual(splitCode('430'), { testament: '', key: '430' });
});

test('looking a code up says what it found, or why it found nothing', () => {
  const held = { H: parseLexicon(FILE, { source: 'h.json' }), G: parseLexicon(GREEK, { source: 'g.json' }) };
  const found = lookup(held, 'H7225');
  assert.equal(found.testament, 'H');
  assert.match(found.entry.define, /the first/);
  assert.equal(found.why, '');

  assert.equal(lookup(held, 'G5485').entry.define, 'grace, favour');
  assert.equal(lookup(held, 'H9999').why, 'absent', 'the lexicon is here and the entry is not');
  assert.equal(lookup({}, 'H7225').why, 'missing', 'the lexicon is not here');
  assert.equal(lookup({}, 'nonsense').why, 'unreadable');
});

test('a bare number is placed only when there is one place it could go', () => {
  const both = { H: parseLexicon(FILE, { source: 'h.json' }), G: parseLexicon(GREEK, { source: 'g.json' }) };
  // 430 is God in Hebrew and something else entirely in Greek; with both
  // lexicons held, guessing would be worse than saying so.
  assert.equal(lookup(both, '430').why, 'ambiguous');
  const hebrewOnly = { H: both.H };
  assert.equal(lookup(hebrewOnly, '430').entry.define, 'gods in the ordinary sense');
  assert.equal(lookup({}, '430').why, 'none');
});

test('STEPBible brief lexicon: keyed by extended number, the plain sense kept, the meaning as text', async () => {
  const { readFileSync } = await import('node:fs');
  const { readLexiconFile, lookup } = await import('../../app/core/lexicon.js');
  const { root } = await import('../helpers.js');
  const text = readFileSync(root('test/fixtures/originals/tbesh-extract.txt'), 'utf8');
  const lex = readLexiconFile(text, { source: 'tbesh.txt' });
  assert.equal(lex.testament, 'H');
  assert.match(lex.name, /Translators Brief lexicon of Extended Strongs for Hebrew/);
  assert.match(lex.source, /CC BY/);
  assert.equal(lex.entries['1254a'].lemma.normalize('NFC'), 'בָּרָא'.normalize('NFC'));
  assert.equal(lex.entries['1254a'].translit, 'ba.ra');
  assert.match(lex.entries['1254a'].define, /^to create\n1\) to create, shape, form/);
  assert.match(lex.entries['1254b'].define, /^to fatten/);
  assert.match(lex.entries['1'].define, /^father\n1\) father of an individual/, 'the word, not the names built on it');
  assert.ok(!/<|&nbsp;/.test(lex.entries['1'].define), 'no markup left');
  const held = { H: lex };
  assert.equal(lookup(held, 'H1254A').entry.translit, 'ba.ra', 'the sense as tagged');
  assert.equal(lookup(held, 'H430').entry.translit, 'e.lo.him');
  const plain = lookup(held, 'H1254');
  assert.equal(plain.entry.translit, 'ba.ra', 'a plain number, as the KJV and WLC tag it, finds its first sense');
  assert.deepEqual(plain.senses, ['1254a', '1254b'], 'and says it is one of two');
  assert.deepEqual(lookup(held, 'H1254A').senses, [], 'a sense asked for by name is not one of several');
});

test('a gloss is the opening words of an entry, short enough to sit under a word', async () => {
  const { glossOf } = await import('../../app/core/lexicon.js');
  assert.equal(glossOf({ define: 'to create\n1) to create, shape, form' }), 'to create');
  assert.equal(glossOf({ define: 'God; gods, judges, angels' }), 'God');
  assert.equal(glossOf({ define: 'beginning (of time), first' }), 'beginning');
  assert.equal(glossOf({ define: 'a very long gloss that goes on well past any column width' }).length, 28);
  assert.match(glossOf({ define: 'a very long gloss that goes on well past any column width' }), /…$/);
  assert.equal(glossOf(null), '');
  assert.equal(glossOf({ define: '' }), '');
});
