/**
 * The fast fold must find exactly what the original, one-character-at-a-time
 * fold found, with the highlight on the same characters. The reference below
 * is that original, kept here as the definition.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatcher } from '../app/core/search.js';

const MARKS = /[̀-ͯ]/g;
const WORD = /[\p{L}\p{N}_]/u;
function reference(query, text, { mode = 'terms', matchCase = false } = {}) {
  const fold = (s) => {
    const out = []; const map = [];
    for (let i = 0; i < s.length; i += 1) {
      const d = s[i].normalize('NFD').replace(MARKS, '');
      for (const ch of matchCase ? d : d.toLowerCase()) { out.push(ch); map.push(i); }
    }
    map.push(s.length);
    return { folded: out.join(''), map };
  };
  const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)].map(([, q, b]) => fold(q ?? b).folded.trim()).filter(Boolean);
  const { folded, map } = fold(text);
  const ranges = [];
  for (const term of terms) {
    let from = 0; let found = false;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      from = at + term.length;
      if (mode === 'word' && (WORD.test(folded[at - 1] ?? ' ') || WORD.test(folded[from] ?? ' '))) continue;
      ranges.push({ start: map[at], end: map[from] }); found = true;
    }
    if (!found) return null;
  }
  return ranges.sort((a, b) => a.start - b.start);
}

const texts = [
  'In the beginning God created the heaven and the earth.',
  'And God said, Let there be light: and there was light.',
  'Så elsket Gud verden at han gav sin Sønn, den enbårne',
  'Café résumé naïve ÉLAN coöperate — “quoted” text',
  'အစအဦး၌ ဘုရားသခင်သည် ကောင်းကင်နှင့် မြေကြီးကို ဖန်ဆင်းတော်မူ၏။',
  'Pasian in vantung leh leitung a piangsak hi.',
  'ﬁne ǅ İstanbul ΣΟΦΟΣ ẞ',
  '',
];
const queries = ['god', 'light', 'gud', 'cafe', 'resume', 'ELAN', '"the earth"', 'ဘုရားသခင်', 'မြေကြီး', 'pasian hi', 'istanbul', 'σοφος', 'fi', 'the', 'e', 'x'];

test('the fast fold matches the reference fold exactly', () => {
  for (const text of texts) {
    for (const query of queries) {
      for (const mode of ['terms', 'word']) {
        for (const matchCase of [false, true]) {
          const matcher = createMatcher(query, { mode, matchCase });
          if (matchCase) continue; // the reference folds case; case-kept runs below
          assert.deepEqual(matcher.test(text), reference(query, text, { mode }), `${mode} "${query}" in "${text}"`);
        }
      }
    }
  }
});

test('with case kept, a capital is not a small letter', () => {
  const matcher = createMatcher('God', { matchCase: true });
  assert.deepEqual(matcher.test('God and god'), [{ start: 0, end: 3 }]);
  assert.equal(createMatcher('ÉLAN', { matchCase: true }).test('élan'), null);
  assert.deepEqual(createMatcher('ELAN', { matchCase: true }).test('x ÉLAN'), [{ start: 2, end: 6 }]);
});
