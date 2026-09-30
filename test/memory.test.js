/**
 * Memory verses: the spacing, what is hidden, and a stored record read back
 * for what is valid in it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardId, dueCards, LEARNED_BOX, mask, newCard, readCards, review, summary, words, writeCards } from '../app/core/memory.js';

const noon = new Date(2026, 8, 30, 12, 0, 0).getTime();
const midnightIn = (days) => { const d = new Date(noon); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + days); return d.getTime(); };

test('a new card is due at once, and each "Got it" pushes it further out', () => {
  let card = newCard({ book: 19, chapter: 23, verse: 1, to: 3, identify: 'kjv1611' }, noon);
  assert.equal(card.id, cardId(19, 23, 1));
  assert.equal(card.due, noon);
  assert.equal(card.to, 3);
  const expected = [1, 3, 7, 14, 30, 90, 90];
  for (const days of expected) {
    card = review(card, 'good', noon);
    assert.equal(card.due, midnightIn(days), `due in ${days} days, at midnight`);
  }
  assert.ok(card.box >= LEARNED_BOX);
});

test('"Hard" keeps the box and comes back sooner; "Again" starts over in ten minutes', () => {
  let card = newCard({ book: 1, chapter: 1, verse: 1 }, noon);
  card = review(card, 'good', noon); // box 1
  card = review(card, 'good', noon); // box 2, 3 days
  const hard = review(card, 'hard', noon);
  assert.equal(hard.box, 2);
  assert.equal(hard.due, midnightIn(2), 'half of three days, rounded');
  const again = review(card, 'again', noon);
  assert.equal(again.box, 0);
  assert.equal(again.lapses, 1);
  assert.equal(again.due, noon + 10 * 60 * 1000);
  assert.throws(() => review(card, 'easy'), /grade must be one of again, hard, good/);
});

test('bad passages are refused with the reason', () => {
  assert.throws(() => newCard({ book: 0, chapter: 1, verse: 1 }), /book must be a positive whole number/);
  assert.throws(() => newCard({ book: 1, chapter: 1, verse: 5, to: 3 }), /at or after 5/);
});

test('what is due, and how the set stands', () => {
  const a = newCard({ book: 1, chapter: 1, verse: 1 }, noon - 1000);
  const b = review(newCard({ book: 1, chapter: 1, verse: 2 }, noon), 'good', noon);
  const c = newCard({ book: 1, chapter: 1, verse: 3 }, noon - 5000);
  assert.deepEqual(dueCards([a, b, c], noon).map((x) => x.verse), [3, 1], 'the most overdue first; b is tomorrow');
  const s = summary([a, b, c], noon);
  assert.deepEqual({ total: s.total, due: s.due, learned: s.learned, next: s.next }, { total: 3, due: 2, learned: 0, next: midnightIn(1) });
});

test('a stored record is read for what is valid in it', () => {
  const good = newCard({ book: 43, chapter: 3, verse: 16 }, noon);
  const cards = readCards({ v: 1, cards: [good, { ...good }, { book: 'x' }, { ...good, verse: 17, id: 'n', box: 99 }, null] });
  assert.deepEqual(cards.map((c) => c.id), ['43.3.16'], 'duplicates, junk and an impossible box are dropped');
  assert.deepEqual(readCards(writeCards(cards)), cards, 'what is written reads back the same');
  assert.deepEqual(readCards({ v: 2, cards: [good] }), [], 'another version is not guessed at');
});

test('words are words, with the punctuation left in sight', () => {
  const parts = words('The LORD is my shepherd; I shall not want.');
  assert.deepEqual(parts.filter((p) => p.word).map((p) => p.text), ['The', 'LORD', 'is', 'my', 'shepherd', 'I', 'shall', 'not', 'want']);
  assert.ok(parts.some((p) => !p.word && p.text === ';'));
  assert.equal(parts.map((p) => p.text).join(''), 'The LORD is my shepherd; I shall not want.', 'nothing lost');
});

test('Burmese is cut into syllables', () => {
  const text = 'ထာဝရဘုရားသည် ငါ၏သိုးထိန်း';
  const parts = words(text);
  assert.equal(parts.map((p) => p.text).join(''), text, 'nothing lost');
  const syllables = parts.filter((p) => p.word).map((p) => p.text);
  // ၏ is a mark, like a comma, and stays in sight.
  assert.deepEqual(syllables, ['ထာ', 'ဝ', 'ရ', 'ဘု', 'ရား', 'သည်', 'ငါ', 'သိုး', 'ထိန်း']);
});

test('hiding gets harder with the box, the same way every time', () => {
  const text = 'For God so loved the world, that he gave his only begotten Son';
  const count = (level) => mask(text, level, '43.3.16').filter((p) => p.hidden).length;
  const total = words(text).filter((p) => p.word).length;
  assert.equal(count('none'), 0);
  assert.equal(count('third'), Math.round(total / 3));
  assert.equal(count('half'), Math.round(total / 2));
  assert.equal(count('all'), total);
  assert.deepEqual(mask(text, 'half', '43.3.16'), mask(text, 'half', '43.3.16'), 'the same words each time');
  assert.notDeepEqual(mask(text, 'half', '43.3.16').map((p) => p.hidden), mask(text, 'half', '1.1.1').map((p) => p.hidden),
    'a different verse hides differently');
  const initials = mask(text, 'initials', 'x').filter((p) => p.word);
  assert.ok(initials.every((p) => p.hidden && p.hint === p.text[0]));
  assert.throws(() => mask(text, 'most', 'x'), /unknown level/);
});
