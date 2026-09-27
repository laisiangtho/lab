import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  chooseVoice, forgetVoice, isCrossed, parseVoiceMemory, rememberVoice, voicesForLanguage,
} from '../../app/core/voices.js';

const voice = (uri, lang, extra = {}) => ({ voiceURI: uri, lang, ...extra });
const DEVICE = [
  voice('en-uk', 'en-GB', { localService: true }),
  voice('en-us', 'en-US', { default: true }),
  voice('nb', 'nb-NO', { localService: true }),
  voice('my', 'my-MM'),
];

test('a voice is matched on the language, not on the exact tag', () => {
  // The file says "mya"; the device says "my-MM". They are the same language.
  assert.deepEqual(voicesForLanguage(DEVICE, 'mya').map((v) => v.voiceURI), ['my']);
  assert.deepEqual(voicesForLanguage(DEVICE, 'eng').map((v) => v.voiceURI), ['en-uk', 'en-us']);
  assert.deepEqual(voicesForLanguage(DEVICE, 'ctd'), [], 'and a language with no voice has none');
  assert.deepEqual(voicesForLanguage(DEVICE, ''), []);
});

test('with nothing chosen, the engine\'s own preference is followed', () => {
  const memory = parseVoiceMemory(null);
  assert.equal(chooseVoice(memory, { identify: 'kjv', tag: 'eng' }, DEVICE).voiceURI, 'en-us', 'the default voice');
  assert.equal(chooseVoice(memory, { identify: 'tedim', tag: 'ctd' }, DEVICE), null,
    'and a language with no voice says so rather than reading it in English');
});

test('a voice chosen for a language serves every translation in it', () => {
  let memory = parseVoiceMemory(null);
  memory = rememberVoice(memory, { identify: 'kjv', tag: 'eng' }, voice('en-uk', 'en-GB'));
  assert.equal(chooseVoice(memory, { identify: 'kjv', tag: 'eng' }, DEVICE).voiceURI, 'en-uk');
  assert.equal(chooseVoice(memory, { identify: 'asv', tag: 'eng' }, DEVICE).voiceURI, 'en-uk', 'a fact about the device');
  assert.ok(!isCrossed(memory, 'kjv'), 'and nothing odd is being remembered');
});

test('a voice from another language is remembered against the translation alone', () => {
  let memory = parseVoiceMemory(null);
  memory = rememberVoice(memory, { identify: 'kjv', tag: 'eng' }, voice('nb', 'nb-NO'));
  assert.equal(chooseVoice(memory, { identify: 'kjv', tag: 'eng' }, DEVICE).voiceURI, 'nb', 'the King James, in Norwegian');
  assert.equal(chooseVoice(memory, { identify: 'asv', tag: 'eng' }, DEVICE).voiceURI, 'en-us',
    'and every other English translation is untouched');
  assert.ok(isCrossed(memory, 'kjv'));

  // Which is also how a language with no voice of its own gets read at all.
  let other = rememberVoice(parseVoiceMemory(null), { identify: 'tedim', tag: 'ctd' }, voice('my', 'my-MM'));
  assert.equal(chooseVoice(other, { identify: 'tedim', tag: 'ctd' }, DEVICE).voiceURI, 'my');
  other = forgetVoice(other, 'tedim');
  assert.equal(chooseVoice(other, { identify: 'tedim', tag: 'ctd' }, DEVICE), null, 'and undoing it is one press');
});

test('choosing the language\'s own voice again clears the oddity rather than agreeing with it', () => {
  let memory = rememberVoice(parseVoiceMemory(null), { identify: 'kjv', tag: 'eng' }, voice('nb', 'nb-NO'));
  memory = rememberVoice(memory, { identify: 'kjv', tag: 'eng' }, voice('en-uk', 'en-GB'));
  assert.ok(!isCrossed(memory, 'kjv'), 'no override left behind to outlive the choice');
  assert.equal(memory.byLang.eng, 'en-uk');
});

test('a voice that is no longer installed is not insisted upon', () => {
  const memory = parseVoiceMemory({ byTranslation: { kjv: 'gone' }, byLang: { eng: 'also-gone' } });
  assert.equal(chooseVoice(memory, { identify: 'kjv', tag: 'eng' }, DEVICE).voiceURI, 'en-us');
});

test('what the first version wrote down is still read', () => {
  // A flat map of language to voice, which is what was stored before a
  // translation could have a voice of its own.
  const memory = parseVoiceMemory({ en: 'en-uk', my: 'my' });
  assert.equal(memory.byLang.en, 'en-uk');
  assert.deepEqual(memory.byTranslation, {});
  assert.equal(chooseVoice(memory, { identify: 'kjv', tag: 'en' }, DEVICE).voiceURI, 'en-uk');
  assert.deepEqual(parseVoiceMemory(null), { byLang: {}, byTranslation: {} });
  assert.deepEqual(parseVoiceMemory({ byLang: { en: 5 } }).byLang, {}, 'and nonsense is dropped');
});
