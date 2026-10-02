/**
 * Interface strings. Scripture carries its own language; this covers the shell.
 *
 * L('lbl.verses', { n: 6 }) → "6 verses". Placeholders are {name}; a string
 * with a "|" holds singular|plural for the {n} value, and a language with one
 * plural form (Burmese) writes one form and no "|".
 *
 * English and Norwegian are files in ./locales and part of the app. English
 * is the source; Norwegian is checked against it by test/locales.test.js —
 * same keys, same placeholders, plural forms that fit the language — so a
 * string missing from it fails the build.
 *
 * Every other language is fetched from the catalog repository when a reader
 * chooses it (services/locales.js, core/locale.js) and added here with
 * `addLocale` before the interface is built. Their sources are the JSON
 * files in this repository's `locale/` folder, held to the same test. The
 * app may still be newer than a device's copy: a string that copy lacks is
 * shown in English, and Settings says how many there are.
 */

import { relativeTime } from '../core/time.js';
import en from './locales/en.js';
import nb from './locales/nb.js';

/**
 * The interface languages, each named in itself: the list is read by someone
 * looking for their own language, not for its English name. `review` marks a
 * translation not yet checked by a native speaker, which Settings says.
 */
export const BUILT_IN = Object.freeze(['en', 'nb']);

const LOCALES = {
  en: Object.freeze({ name: 'English', strings: en, forms: 2 }),
  nb: Object.freeze({ name: 'Norsk bokmål', strings: nb, forms: 2 }),
};

/** The languages the interface can be in right now: built in, or added. */
export const locales = () => Object.entries(LOCALES).map(([code, { name, review }]) => ({ code, name, review: review === true }));
export const hasLocale = (code) => Object.hasOwn(LOCALES, code);

/**
 * A fetched language (core/locale.js) made available. Built-in ones are not
 * replaced: what the app ships is what the app was tested with.
 */
export function addLocale({ code, name, strings, forms, review = false }) {
  if (BUILT_IN.includes(code)) throw new Error(`i18n: "${code}" is built in and is not replaced`);
  LOCALES[code] = Object.freeze({ name, strings, forms, review });
}

/** English, for what is checked against it. */
export const englishStrings = () => en;

let locale = 'en';
/** 'one' or 'other' for a number, in the locale in force. */
let pluralOf = (n) => new Intl.PluralRules('en').select(n);

export function L(key, vars = {}) {
  // English stands in only for a key the tests would already have refused.
  let text = LOCALES[locale].strings[key] ?? en[key];
  if (text === undefined) return key;
  if (text.includes('|') && vars.n !== undefined) {
    const [one, other] = text.split('|');
    text = pluralOf(vars.n) === 'one' ? one : other;
  }
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? `{${name}}` : String(vars[name])));
}

/** The strings of the locale in force, for what counts them. */
L.strings = () => LOCALES[locale].strings;

/**
 * Whether a string exists, for a feature that finds its text by pattern (the
 * guide reads every setting's name and sentence). Every locale has the same
 * keys, which the locale tests hold them to, so English answers for all.
 */
export const hasString = (key) => Object.hasOwn(en, key);

/** Every string key, for the same purpose. */
export const stringKeys = () => Object.keys(en);

/** The locale in force. */
export function currentLocale() {
  return locale;
}

/**
 * The interface language: the reader's choice when there is one, otherwise the
 * first of the device's languages this app has on the device, otherwise
 * English. Norwegian in any written form (no, nb, nn) reads Bokmål, the one
 * Norwegian there is. A language that would have to be fetched is never the
 * answer here: it is offered, and chosen, before it is used.
 *
 * @param {string|null} chosen  settings.locale
 * @param {readonly string[]} languages  navigator.languages
 */
export function resolveLocale(chosen, languages = []) {
  if (chosen && LOCALES[chosen]) return chosen;
  for (const tag of languages) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if (base === 'no' || base === 'nb' || base === 'nn') return 'nb';
    if (LOCALES[base]) return base;
  }
  return 'en';
}

export function setLocale(next) {
  if (!LOCALES[next]) throw new Error(`i18n: no strings for locale "${next}"`);
  locale = next;
  // A language written in one form has one form, whatever the platform's
  // rules know or do not know of it (Intl has none for Zolai).
  const rules = LOCALES[next].forms === 1 ? null : new Intl.PluralRules(next);
  pluralOf = rules ? (n) => rules.select(n) : () => 'other';
  // What screen readers, hyphenation and font fallback go by.
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

/**
 * Dates and times in the interface language, not the browser's: a Burmese
 * interface showed Norwegian dates on a Norwegian device. Every date the
 * interface writes goes through one of these.
 */
export const when = Object.freeze({
  date: (value) => new Date(value).toLocaleDateString(locale),
  time: (value) => new Date(value).toLocaleTimeString(locale),
  dateTime: (value) => new Date(value).toLocaleString(locale),
  /** "3 min. ago", "yesterday", or a date. */
  ago: (value) => relativeTime(value, { locale }),
});

/**
 * Apply strings to markup written with data attributes:
 *   data-lt  text content      data-lp  placeholder
 *   data-l   title + aria-label
 */
export function applyStrings(root = document) {
  for (const el of root.querySelectorAll('[data-lt]')) el.textContent = L(el.dataset.lt);
  for (const el of root.querySelectorAll('[data-lp]')) el.placeholder = L(el.dataset.lp);
  for (const el of root.querySelectorAll('[data-l]')) {
    const text = L(el.dataset.l);
    el.title = text;
    el.setAttribute('aria-label', text);
  }
}
