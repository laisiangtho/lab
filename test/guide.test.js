/**
 * The guide's matching and memory: the right entry for a question asked the
 * way people ask, in English, Norwegian and Burmese, and a memory that moves
 * the answer a reader chose to the top.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, createIndex, emptyMemory, learn, MEMORY_CAP, readMemory, tokens } from '../app/core/guide.js';

const entries = [
  { id: 'bookmark', title: 'Bookmark a verse', phrases: ['mark a verse', 'save a verse'], text: 'Press the verse number, then the bookmark in the verse bar.', prior: 1.3 },
  { id: 'offline', title: 'Read without a connection', phrases: ['download a translation', 'make available offline'], text: 'In the Library, press Make available offline.', prior: 1.3 },
  { id: 'search', title: 'Search the Bible', phrases: ['find a word', 'look for a phrase'], text: 'Ctrl/⌘ F opens search.' },
  { id: 'theme', title: 'Theme', phrases: ['dark mode', 'light mode'], text: 'Follow the system, or keep one.' },
  { id: 'nb-notat', title: 'Skriv et notat', phrases: ['legg til notater'], text: 'Trykk på versnummeret.' },
  { id: 'my-lang', title: 'ဘာသာစကား ပြောင်းရန်', phrases: ['ဘာသာစကား'], text: 'ဆက်တင်များ တွင် ရွေးပါ' },
  { id: 'my-start', title: 'စတင်အသုံးပြုခြင်း', phrases: ['ဘယ်ကစရမလဲ', 'ဒီအက်ပ် ဘယ်လိုအလုပ်လုပ်လဲ'], text: 'စာကြည့်တိုက်တွင် ဘာသာပြန်တစ်ခု ရွေးပါ' },
  { id: 'my-mark', title: 'အခန်းငယ်ကို စာမှတ်ထည့်ရန်', phrases: ['စာမှတ်များ'], text: 'အခန်းငယ် နံပါတ်ကို နှိပ်ပါ' },
];
const index = createIndex(entries);
const top = (question, options) => ask(index, question, options)[0]?.entry.id ?? null;

test('words, less the ones that carry nothing', () => {
  assert.deepEqual(tokens('How do I bookmark a verse?'), ['bookmark', 'verse']);
  assert.deepEqual(tokens('Hvordan kan jeg lagre et notat?'), ['lagre', 'notat']);
  assert.deepEqual(tokens('Café résumé'), ['cafe', 'resume'], 'Latin accents fold');
});

test('Burmese is matched by character pairs, since it has no spaces', () => {
  const pairs = tokens('ဘာသာစကား');
  assert.ok(pairs.length > 3 && pairs.every((p) => [...p].length === 2), pairs.join(' '));
  assert.equal(top('ဘာသာစကားကို ဘယ်လိုပြောင်းမလဲ'), 'my-lang', 'a sentence with no spaces finds its entry');
  // "How do I add a bookmark": the question words match the start topic's
  // phrasings, and are not what the question is about.
  assert.equal(top('စာမှတ် ဘယ်လိုထည့်ရမလဲ'), 'my-mark');
  assert.ok(!tokens('ဘယ်လိုထည့်ရမလဲ').some((pair) => pair.includes('ဘယ')), 'the question words are gone');
});

test('a question asked the way people ask it', () => {
  assert.equal(top('how do I bookmark a verse'), 'bookmark');
  assert.equal(top('can I read offline?'), 'offline');
  assert.equal(top('download translations'), 'offline', 'a plural finds the singular, by prefix');
  assert.equal(top('dark mode'), 'theme');
  assert.equal(top('finding words'), 'search');
  assert.equal(top('notater'), 'nb-notat');
  assert.equal(top('how do I'), null, 'nothing but stop words is no question');
  assert.equal(top('quantum chromodynamics'), null, 'and an unrelated one finds nothing');
});

test('entries are checked when the index is built', () => {
  assert.throws(() => createIndex([{ id: 'a' }]), /needs an id and a title/);
  assert.throws(() => createIndex([{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }]), /duplicate entry "a"/);
});

test('an answer the reader chose ranks higher next time, and "not this" lowers it', () => {
  const question = 'save my place';
  assert.notEqual(top(question), 'offline');
  let memory = emptyMemory();
  memory = learn(memory, question, 'offline', +1);
  memory = learn(memory, 'save my place please', 'offline', +1);
  const [first] = ask(index, 'save my place', { memory });
  assert.equal(first.entry.id, 'offline');
  assert.equal(first.learned, true, 'and it says it was learned');
  memory = learn(memory, question, 'offline', -1);
  memory = learn(memory, question, 'offline', -1);
  memory = learn(memory, question, 'offline', -1);
  assert.notEqual(top(question, { memory }), 'offline');
});

test('the memory is capped, checked when read, and never changed in place', () => {
  let memory = emptyMemory();
  for (let i = 0; i < MEMORY_CAP + 20; i += 1) memory = learn(memory, `question number ${i} word${i}`, 'theme', 1, i);
  assert.equal(memory.pairs.length, MEMORY_CAP);
  assert.equal(memory.pairs[0].at, 20, 'the oldest go first');
  const before = JSON.stringify(memory);
  learn(memory, 'dark', 'theme', 1);
  assert.equal(JSON.stringify(memory), before);
  assert.deepEqual(readMemory(null), emptyMemory());
  assert.deepEqual(readMemory({ v: 2, pairs: [] }), emptyMemory(), 'another version is not guessed at');
  assert.equal(readMemory({ v: 1, pairs: [{ t: ['a'], id: 'x', n: 1, at: 1 }, { t: 'bad' }] }).pairs.length, 1);
});
