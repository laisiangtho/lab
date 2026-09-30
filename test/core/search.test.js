import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMatcher, normalize, parseQuery, snippet } from '../../app/core/search.js';

const hits = (query, text) => createMatcher(query)?.test(text);

test('words are ANDed, order does not matter', () => {
  assert.ok(hits('god light', 'God said, "Let there be light"'));
  assert.ok(hits('light god', 'God said, "Let there be light"'));
  assert.equal(hits('god darkness', 'God said, "Let there be light"'), null);
});

test('quoted terms match as a phrase', () => {
  assert.ok(hits('"let there be"', 'God said, "Let there be light"'));
  assert.equal(hits('"be there let"', 'God said, "Let there be light"'), null);
});

test('case and Latin accents fold; other scripts keep their marks', () => {
  assert.ok(hits('pasian', 'PASIAN in vantung le leitung a piangsak hi.'));
  assert.ok(hits('etait', 'Il était une lumière'));
  assert.equal(normalize('Ei­n'), normalize('Ei­n'));
  assert.ok(hits('ကမ္ဘာ', 'ကမ္ဘာဦးကျမ်း'));
});

test('ranges point into the original string', () => {
  const text = 'Élan and élan';
  const ranges = hits('élan', text);
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges.map((r) => text.slice(r.start, r.end)), ['Élan', 'élan']);
});

test('empty query has no matcher', () => {
  assert.equal(createMatcher('   '), null);
  assert.deepEqual(parseQuery('love "the world" god'), ['love', 'the world', 'god']);
});

test('snippet frames the first hit', () => {
  const text = 'A'.repeat(80) + 'light' + 'B'.repeat(200);
  const s = snippet(text, hits('light', text));
  assert.ok(s.before.startsWith('…'));
  assert.equal(s.hit, 'light');
  assert.ok(s.after.endsWith('…'));
});

test('whole-word matching stops at a word boundary', () => {
  const inside = createMatcher('man', { mode: 'word' });
  assert.equal(inside.test('in a manner of speaking'), null);
  assert.ok(inside.test('the man said'));
  assert.ok(inside.test('(man)'), 'punctuation is a boundary');
  assert.ok(createMatcher('man', { mode: 'terms' }).test('in a manner of speaking'), 'plain matching still finds it');
});

test('case matters when asked', () => {
  const exact = createMatcher('LORD', { matchCase: true });
  assert.ok(exact.test('the LORD said'));
  assert.equal(exact.test('the Lord said'), null);
  assert.ok(createMatcher('LORD').test('the Lord said'), 'and folds when not asked');
});

test('a regular expression matches as written', () => {
  const m = createMatcher('lig[ht]+', { mode: 'regex' });
  assert.ok(m.test('let there be light'));
  assert.equal(m.test('darkness'), null);
  const text = 'light and LIGHT';
  assert.equal(createMatcher('light', { mode: 'regex' }).test(text).length, 2, 'case folds unless asked');
  assert.equal(createMatcher('light', { mode: 'regex', matchCase: true }).test(text).length, 1);
});

test('a pattern that cannot compile says so', () => {
  // The reason, without the pattern and the flags the reader never typed.
  assert.throws(() => createMatcher('(unclosed', { mode: 'regex' }), /^Error: Unterminated group$/);
  assert.equal(createMatcher('  ', { mode: 'regex' }), null);
});

test('a pattern that can match nothing still terminates', () => {
  const m = createMatcher('x*', { mode: 'regex' });
  assert.ok(m.test('axbxc'));
});

test('an unknown match mode is refused', () => {
  assert.throws(() => createMatcher('a', { mode: 'fuzzy' }), /unknown match mode/);
});

test("a query that is one Strong's number finds the words tagged with it", () => {
  const text = 'In the beginning{H7225} God{H430} created{H1254a} the heaven';
  const plain = 'In the beginning God created the heaven';
  const words = (query) => createMatcher(query).test(text)?.map(({ start, end }) => plain.slice(start, end)) ?? null;
  assert.deepEqual(words('H430'), ['God']);
  assert.deepEqual(words(' h0430 '), ['God'], 'however it is typed');
  assert.deepEqual(words('H1254'), ['created'], 'a number without its sense letter finds every sense');
  assert.deepEqual(words('H1254A'), ['created']);
  assert.equal(words('H1254B'), null);
  assert.equal(createMatcher('430').marked, undefined, 'a bare number is text');
  assert.equal(createMatcher('H430', { mode: 'regex' }).marked, undefined, 'a pattern is a pattern');
});

test('a whole word in Burmese includes the vowel signs written on it', () => {
  const word = (query, text) => createMatcher(query, { mode: 'word' }).test(text);
  assert.equal(word('က', 'ကောင်းကင်'), null, 'က is a letter of ကောင်း, not a word');
  assert.ok(word('ကောင်းကင်', 'ကောင်းကင် နှင့်'));
  assert.equal(word('ကောင်း', 'ကောင်းကင်'), null);
});
