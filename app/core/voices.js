/**
 * Which voice reads which translation.
 *
 * Two questions, and they are not the same one. *What voice for this language?*
 * is a fact about the device — it is the same answer for every English
 * translation on it. *What voice for this translation?* only gets asked when
 * the answer is strange: a language with no voice of its own read in the
 * nearest one there is, or a reader who simply prefers a particular voice for a
 * particular Bible. So they are remembered separately, and the stranger one
 * wins, because it was chosen in the presence of the alternative.
 *
 * Pure. `SpeechSynthesisVoice` objects are passed in as data — anything with
 * `voiceURI` and `lang` will do, which is also what makes this testable without
 * a speech engine.
 */

import { sameLanguage } from './langcode.js';

/**
 * @typedef {{ byLang: Record<string,string>, byTranslation: Record<string,string> }} VoiceMemory
 */

/** @returns {VoiceMemory} */
export function parseVoiceMemory(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // The first version was a flat map of language to voice. It is read as
  // `byLang`, which is what it always meant.
  const flat = !source.byLang && !source.byTranslation ? source : {};
  const strings = (value) => Object.fromEntries(Object.entries(value ?? {})
    .filter(([key, v]) => key && typeof v === 'string' && v));
  return {
    byLang: strings(source.byLang ?? flat),
    byTranslation: strings(source.byTranslation),
  };
}

/**
 * The voice to read a passage in.
 *
 * @param {VoiceMemory} memory
 * @param {{ identify: string, tag: string }} about the translation and its language
 * @param {{ voiceURI: string, lang: string, default?: boolean, localService?: boolean }[]} voices
 * @returns {object|null} null when the device has nothing for that language and
 *          nothing was chosen — which is an answer, and is said out loud rather
 *          than papered over with a voice that reads the words wrongly.
 */
export function chooseVoice(memory, { identify, tag }, voices) {
  const all = Array.isArray(voices) ? voices : [];
  const chosen = all.find((v) => v.voiceURI === memory.byTranslation?.[identify]);
  if (chosen) return chosen;

  const own = voicesForLanguage(all, tag);
  if (!own.length) return null;
  const kept = own.find((v) => v.voiceURI === memory.byLang?.[tag]);
  return kept
    ?? own.find((v) => v.default)
    ?? own.find((v) => v.localService)
    ?? own[0];
}

/** The voices that speak a language, however either of them spells it. */
export function voicesForLanguage(voices, tag) {
  if (!tag) return [];
  return (voices ?? []).filter((v) => sameLanguage(v.lang, tag));
}

/**
 * Remember a choice.
 *
 * Choosing a voice of the text's own language puts that translation back under
 * the ordinary rule rather than leaving behind an override that agrees with it
 * — otherwise the translation would keep that exact voice even after the reader
 * changed their mind about English in general.
 *
 * @returns {VoiceMemory} a new memory; the old one is untouched
 */
export function rememberVoice(memory, { identify, tag }, voice) {
  const own = sameLanguage(voice.lang, tag);
  return {
    byLang: own ? { ...memory.byLang, [tag]: voice.voiceURI } : { ...memory.byLang },
    byTranslation: own ? without(memory.byTranslation, identify) : { ...memory.byTranslation, [identify]: voice.voiceURI },
  };
}

/** Undo a cross-language choice, leaving the language's own voice alone. */
export function forgetVoice(memory, identify) {
  return { byLang: { ...memory.byLang }, byTranslation: without(memory.byTranslation, identify) };
}

/** Whether this translation is being read by a voice from another language. */
export function isCrossed(memory, identify) {
  return Boolean(memory.byTranslation?.[identify]);
}

function without(map, key) {
  return Object.fromEntries(Object.entries(map ?? {}).filter(([k]) => k !== key));
}
