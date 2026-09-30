/**
 * Interface strings. Scripture carries its own language; this covers the shell.
 *
 * L('lbl.verses', { n: 6 }) → "6 verses". Placeholders are {name}; a string
 * with a "|" holds singular|plural for the {n} value, and a language with one
 * plural form (Burmese) writes one form and no "|".
 *
 * Each locale is a file in ./locales. English is the source; every other
 * locale is checked against it by test/locales.test.js — same keys, same
 * placeholders, plural forms that fit the language — so a string missing from
 * a translation fails the build rather than turning up in English on screen.
 */

import { relativeTime } from '../core/time.js';
import en from './locales/en.js';
import my from './locales/my.js';
import nb from './locales/nb.js';

/**
 * The interface languages, each named in itself: the list is read by someone
 * looking for their own language, not for its English name. `review` marks a
 * translation not yet checked by a native speaker, which Settings says.
 */
export const LOCALES = Object.freeze({
  en: Object.freeze({ name: 'English', strings: en }),
  nb: Object.freeze({ name: 'Norsk bokmål', strings: nb }),
  my: Object.freeze({ name: 'မြန်မာ', strings: my, review: true }),
});

let locale = 'en';
let pluralRules = new Intl.PluralRules('en');

export function L(key, vars = {}) {
  // English stands in only for a key the tests would already have refused.
  let text = LOCALES[locale].strings[key] ?? en[key];
  if (text === undefined) return key;
  if (text.includes('|') && vars.n !== undefined) {
    const [one, other] = text.split('|');
    text = pluralRules.select(vars.n) === 'one' ? one : other;
  }
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? `{${name}}` : String(vars[name])));
}

/** The locale in force. */
export function currentLocale() {
  return locale;
}

/**
 * The interface language: the reader's choice when there is one, otherwise the
 * first of the device's languages this app has, otherwise English. Norwegian in
 * any written form (no, nb, nn) reads Bokmål, the one Norwegian there is.
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
  pluralRules = new Intl.PluralRules(next);
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
