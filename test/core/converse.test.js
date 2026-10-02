import test from 'node:test';
import assert from 'node:assert/strict';
import { intentOf, scopeOf } from '../../app/core/converse.js';

test('the questions worked out rather than looked up', () => {
  const cases = {
    'What time is it?': 'time', 'what is the time': 'time', 'Hva er klokka?': 'time', 'အခု ဘယ်နှနာရီလဲ': 'time',
    'what day is it today?': 'date', "what's the date": 'date', 'hvilken dag er det i dag': 'date',
    'How many books are in the Bible?': 'books', 'how many books in the new testament': 'books', 'hvor mange bøker i bibelen': 'books',
    'how many chapters in Psalms?': 'chapters', 'How many chapters does Genesis have': 'chapters',
    'how many verses in John 3': 'verses', 'how many verses are there in the bible': 'verses',
    'where am I?': 'where', 'where are you now?': 'where', 'hvor er jeg': 'where',
    'who are you?': 'who', 'What are you': 'who', 'are you an AI?': 'who', 'hvem er du': 'who',
    'can you help me?': 'help', 'how can you help me': 'help', 'what can you do?': 'help',
    'what should I do?': 'start', "I'm new here": 'start',
    'play the walkthrough again': 'tour', 'show me around': 'tour', 'Take the tour': 'tour', 'tutorial': 'tour', 'can you show me the tour again': 'tour',
    'hello': 'hello', 'Good morning!': 'hello', 'hei': 'hello', 'thanks!': 'thanks', 'how are you?': 'how',
    'how many translations do I have': 'translations', 'what version is this': 'version',
  };
  cases['hva skal jeg gjøre'] = 'start';
  for (const [question, intent] of Object.entries(cases)) {
    assert.equal(intentOf(question)?.intent, intent, question);
  }
});

test('a request is not small talk', () => {
  for (const question of ['help me make a note', 'how do I bookmark a verse', 'search for love', 'why is it dark',
    'how do I walk through a passage', 'is there a tutorial on notes']) {
    assert.equal(intentOf(question), null, question);
  }
});

test('what a count is of', () => {
  const books = { psalms: 19, genesis: 1, john: 43, '1 john': 62 };
  const read = (text) => {
    const m = /^(\d?\s?[a-z]+)\s*(\d+)?/.exec(text);
    const book = books[m?.[1]?.trim()];
    return book ? { book, chapter: Number(m[2] ?? 1) } : null;
  };
  assert.deepEqual(scopeOf(intentOf('how many chapters in psalms').rest, read), { scope: 'book', book: 19 });
  assert.deepEqual(scopeOf(intentOf('how many verses in john 3?').rest, read), { scope: 'chapter', book: 43, chapter: 3 });
  assert.deepEqual(scopeOf(intentOf('how many verses in 1 john').rest, read), { scope: 'book', book: 62 });
  assert.deepEqual(scopeOf(intentOf('how many books are in the bible').rest, read), { scope: 'bible' });
  assert.deepEqual(scopeOf(intentOf('how many books in the old testament').rest, read), { scope: 'testament', testament: 1 });
  assert.deepEqual(scopeOf(intentOf('how many chapters').rest, read), { scope: 'bible' });
  assert.deepEqual(scopeOf('narnia', read), { scope: 'unknown', text: 'narnia' });
});

test('a subject, for the reader\'s own dictionaries and topical indexes', () => {
  assert.equal(intentOf('who was the first tour guide')?.intent, 'define', 'a word in a question is not the question');
  assert.deepEqual(intentOf('What is grace?'), { intent: 'define', rest: 'grace' });
  assert.deepEqual(intentOf('who was Aaron'), { intent: 'define', rest: 'aaron' });
  assert.deepEqual(intentOf('tell me about Moses'), { intent: 'define', rest: 'moses' });
  assert.deepEqual(intentOf('what does redemption mean?'), { intent: 'define', rest: 'redemption' });
  assert.deepEqual(intentOf('hva er nåde'), { intent: 'define', rest: 'nåde' });
  assert.deepEqual(intentOf('what does the Bible say about prayer?'), { intent: 'about', rest: 'prayer' });
  assert.deepEqual(intentOf('verses about light'), { intent: 'about', rest: 'light' });
  assert.equal(intentOf('what is the time')?.intent, 'time', 'the clock first');
  assert.equal(intentOf('who are you')?.intent, 'who');
});
