/**
 * An interface language that is not built in: a file in the catalog
 * repository's `locale/` folder, fetched when a reader chooses it.
 *
 *   locale/index.json   { "locales": [ { code, name, english, version, strings, review? } ] }
 *   locale/<code>.json  { code, name, english, forms, review?, strings: { key: text } }
 *
 *   code      what the setting stores and `lang` is set to (BCP 47: "my", "ctd")
 *   name      the language in itself, as the list of languages shows it
 *   english   its name in English, for whoever maintains the files
 *   forms     how many plural forms its strings are written in: 1 (one form
 *             for every number, no "|") or 2 (singular|plural)
 *   review    true while no native speaker has checked it; Settings says so
 *   version   in the index: a fingerprint of the file, so a device knows
 *             when its copy is old (scripts/locale.mjs writes it)
 *   strings   in the index: how many strings the file has
 *
 * English and Norwegian are built in; these are the rest. A file is checked
 * for shape here and refused by name when it is wrong. It is not checked for
 * completeness: the app may be newer than the file, and a string the file
 * lacks is shown in English (`coverage` says how many, and Settings says it).
 *
 * Pure.
 */

import { expectArray, expectObject, expectString, fail } from './errors.js';

const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Whether a stored setting may name this as the interface language. */
export const isLocaleCode = (value) => typeof value === 'string' && CODE.test(value);

function readCode(value, source, path) {
  const code = expectString(value, source, path);
  if (!CODE.test(code)) fail(source, path, `expected a language code such as "my" or "ctd", got ${JSON.stringify(code)}`);
  return code;
}

/**
 * @param {unknown} raw  locale/index.json
 * @returns {readonly { code: string, name: string, english: string, version: string, strings: number, review: boolean }[]}
 */
export function parseLocaleIndex(raw, source = 'locale/index.json') {
  expectObject(raw, source, '$');
  const seen = new Set();
  return Object.freeze(expectArray(raw.locales, source, '$.locales').map((entry, i) => {
    const p = `$.locales[${i}]`;
    expectObject(entry, source, p);
    const code = readCode(entry.code, source, `${p}.code`);
    if (seen.has(code)) fail(source, `${p}.code`, `"${code}" is listed twice`);
    seen.add(code);
    if (!Number.isInteger(entry.strings) || entry.strings < 1) fail(source, `${p}.strings`, `expected a count above zero, got ${JSON.stringify(entry.strings)}`);
    return Object.freeze({
      code,
      name: expectString(entry.name, source, `${p}.name`),
      english: expectString(entry.english, source, `${p}.english`),
      version: expectString(entry.version, source, `${p}.version`),
      strings: entry.strings,
      review: entry.review === true,
    });
  }));
}

/**
 * @param {unknown} raw   locale/<code>.json
 * @param {string} code   the code it was asked for by: the file must agree
 */
export function parseLocale(raw, code, source = `locale/${code}.json`) {
  expectObject(raw, source, '$');
  const own = readCode(raw.code, source, '$.code');
  if (own !== code) fail(source, '$.code', `expected ${code}, file declares ${own}`);
  if (raw.forms !== 1 && raw.forms !== 2) fail(source, '$.forms', `expected 1 or 2 plural forms, got ${JSON.stringify(raw.forms)}`);
  const strings = expectObject(raw.strings, source, '$.strings');
  const out = {};
  for (const [key, text] of Object.entries(strings)) {
    if (typeof text !== 'string' || !text.trim()) fail(source, `$.strings.${key}`, 'expected text');
    out[key] = text;
  }
  if (!Object.keys(out).length) fail(source, '$.strings', 'expected at least one string');
  return Object.freeze({
    code,
    name: expectString(raw.name, source, '$.name'),
    english: expectString(raw.english, source, '$.english'),
    forms: raw.forms,
    review: raw.review === true,
    strings: Object.freeze(out),
  });
}

/** How much of what the app says a set of strings covers: { have, missing }. */
export function coverage(strings, keys) {
  let have = 0;
  for (const key of keys) if (Object.hasOwn(strings, key)) have += 1;
  return { have, missing: keys.length - have };
}

/**
 * What a locale file must be to be published, checked against English: the
 * same keys, the same placeholders, plural forms as the file declares. The
 * app does not ask this of a file it downloads; the repository asks it of a
 * file before it goes out (scripts/locale.mjs, test/locales.test.js).
 *
 * @returns {string[]} what is wrong, one line each; empty when nothing is
 */
export function auditLocale(locale, english) {
  const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');
  const out = [];
  for (const key of Object.keys(english)) if (!Object.hasOwn(locale.strings, key)) out.push(`${key}: missing`);
  for (const [key, text] of Object.entries(locale.strings)) {
    const source = english[key];
    if (source === undefined) { out.push(`${key}: not a string the app has`); continue; }
    if (placeholders(text) !== placeholders(source)) out.push(`${key}: placeholders differ from English ({${placeholders(source)}})`);
    const bars = text.split('|').length - 1;
    const wanted = source.includes('|') && locale.forms === 2 ? 1 : 0;
    if (bars !== wanted) out.push(`${key}: expected ${wanted ? 'singular|plural' : 'one form and no "|"'}`);
  }
  return out;
}
