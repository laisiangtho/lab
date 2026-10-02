/**
 * Every interface locale says everything English says, in a shape L() can use.
 *
 * At run time a string missing from a locale would fall back to English and
 * nobody would notice until a reader met it; here it fails the build instead,
 * with the key and the locale named.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readdirSync, readFileSync } from 'node:fs';

import { auditLocale, coverage, isLocaleCode, parseLocale, parseLocaleIndex } from '../app/core/locale.js';
import { parseSettings } from '../app/core/settings.js';
import { addLocale, BUILT_IN, englishStrings, hasLocale, L, locales, resolveLocale, setLocale } from '../app/shell/i18n.js';
import nb from '../app/shell/locales/nb.js';
import { buildIndex, indexText } from '../scripts/locale.mjs';
import { category } from './helpers.js';

const en = englishStrings();
// The languages the app fetches: this repository's locale/<code>.json, which
// the catalog repository publishes. Added here the way the app adds them.
const fetched = readdirSync('locale').filter((name) => name.endsWith('.json') && name !== 'index.json')
  .map((name) => parseLocale(JSON.parse(readFileSync(`locale/${name}`, 'utf8')), name.slice(0, -5)));
for (const locale of fetched) addLocale(locale);
const STRINGS = { nb, ...Object.fromEntries(fetched.map((locale) => [locale.code, locale.strings])) };
const FORMS = { nb: 2, ...Object.fromEntries(fetched.map((locale) => [locale.code, locale.forms])) };
const others = Object.keys(STRINGS);
// The set, not the count: '{n} verse|{n} verses' has {n} twice and a language
// with one plural form rightly writes it once.
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('English and Norwegian are built in; Burmese and Zolai are fetched', () => {
  assert.deepEqual([...BUILT_IN], ['en', 'nb']);
  assert.deepEqual(fetched.map((locale) => locale.code).sort(), ['ctd', 'my']);
  assert.deepEqual(locales().map((one) => one.code).sort(), ['ctd', 'en', 'my', 'nb']);
  assert.throws(() => addLocale({ code: 'en', name: 'x', strings: {}, forms: 2 }), /built in/);
});

test('a stored setting keeps any language code, and drops what is not one', () => {
  const read = (locale) => parseSettings({ locale }, { category }).locale;
  assert.equal(read('ctd'), 'ctd', 'a language this device has yet to fetch is still the choice');
  assert.equal(read('my'), 'my');
  assert.equal(read('not a code'), null);
  assert.equal(read(7), null);
  assert.ok(isLocaleCode('nb') && !isLocaleCode('NB!'));
});

test('locale/index.json is what the files in locale/ make it', () => {
  const index = buildIndex();
  assert.equal(readFileSync('locale/index.json', 'utf8'), indexText(index), 'run: node scripts/locale.mjs --apply');
  assert.deepEqual(parseLocaleIndex(index).map((one) => one.code), ['ctd', 'my']);
});

test('a locale file is refused by name when its shape is wrong', () => {
  const good = { code: 'xx', name: 'X', english: 'X', forms: 1, strings: { 'app.name': 'x' } };
  assert.equal(parseLocale(good, 'xx').forms, 1);
  assert.throws(() => parseLocale(good, 'yy'), /expected yy, file declares xx/);
  assert.throws(() => parseLocale({ ...good, forms: 3 }, 'xx'), /1 or 2 plural forms/);
  assert.throws(() => parseLocale({ ...good, strings: { a: '' } }, 'xx'), /\$\.strings\.a/);
  assert.throws(() => parseLocaleIndex({ locales: [{ code: 'xx', name: 'X', english: 'X', version: 'v', strings: 1 }, { code: 'xx', name: 'X', english: 'X', version: 'v', strings: 1 }] }), /listed twice/);
  assert.deepEqual(coverage({ a: '1' }, ['a', 'b', 'c']), { have: 1, missing: 2 });
  assert.deepEqual(auditLocale({ forms: 1, strings: { 'lbl.verses': '{n} x|{n} y', nope: 'z' } }, { 'lbl.verses': '{n} verse|{n} verses', 'app.name': 'A' }),
    ['app.name: missing', 'lbl.verses: expected one form and no "|"', 'nope: not a string the app has']);
});

for (const id of others) {
  const strings = STRINGS[id];
  const singleForm = FORMS[id] === 1;
  const plural = singleForm ? ['other'] : ['one', 'other'];

  test(`${id}: every English string, and nothing else`, () => {
    const missing = Object.keys(en).filter((k) => !(k in strings));
    const extra = Object.keys(strings).filter((k) => !(k in en));
    assert.deepEqual(missing, [], `${id} is missing ${missing.length}: ${missing.slice(0, 12).join(', ')}`);
    assert.deepEqual(extra, [], `${id} has keys English does not: ${extra.join(', ')}`);
  });

  test(`${id}: no empty strings, and the same placeholders`, () => {
    for (const [key, text] of Object.entries(strings)) {
      assert.equal(typeof text, 'string', `${id} ${key} is not a string`);
      assert.ok(text.trim().length > 0, `${id} ${key} is empty`);
      if (key in en) assert.deepEqual(placeholders(text), placeholders(en[key]), `${id} ${key}: placeholders differ from English`);
    }
  });

  test(`${id}: plural forms fit the language (${plural.join(', ')})`, () => {
    for (const [key, source] of Object.entries(en)) {
      const text = strings[key];
      if (text === undefined) continue;
      const bars = text.split('|').length - 1;
      if (!source.includes('|')) {
        assert.equal(bars, 0, `${id} ${key}: a "|" where English has no plural`);
      } else if (singleForm) {
        // One form for every number: a second would never be shown.
        assert.equal(bars, 0, `${id} ${key}: ${id} has one plural form, so no "|"`);
      } else {
        assert.equal(bars, 1, `${id} ${key}: expected singular|plural`);
      }
    }
  });

  test(`${id}: translated, not copied`, () => {
    const same = Object.keys(en).filter((k) => strings[k] === en[k]);
    // Names, formats and symbols are legitimately the same in every language.
    assert.ok(same.length / Object.keys(en).length < 0.08,
      `${id}: ${same.length} strings are identical to English — ${same.slice(0, 15).join(', ')}`);
  });
}

test('the device language picks the interface, and English is the fallback', () => {
  assert.equal(resolveLocale(null, ['nb-NO', 'en-US']), 'nb');
  assert.equal(resolveLocale(null, ['no']), 'nb');
  assert.equal(resolveLocale(null, ['nn-NO']), 'nb');
  assert.equal(resolveLocale(null, ['my-MM']), 'my', 'a fetched language, once it is on the device');
  assert.equal(resolveLocale(null, ['de-DE', 'my']), 'my');
  assert.equal(resolveLocale('km', ['nb-NO']), 'nb', 'a choice that is not on the device follows the device');
  assert.ok(!hasLocale('km'));
  assert.equal(resolveLocale(null, ['de-DE', 'fr']), 'en');
  assert.equal(resolveLocale(null, []), 'en');
  assert.equal(resolveLocale('my', ['nb-NO']), 'my', 'a chosen locale beats the device');
  assert.equal(resolveLocale('en', ['nb-NO']), 'en');
});

test('plurals follow the locale in force', () => {
  setLocale('en');
  assert.match(L('lbl.verses', { n: 1 }), /^1 verse$/);
  assert.match(L('lbl.verses', { n: 2 }), /^2 verses$/);
  setLocale('nb');
  assert.notEqual(L('lbl.verses', { n: 1 }), L('lbl.verses', { n: 2 }));
  for (const id of ['my', 'ctd']) {
    setLocale(id);
    assert.equal(L('lbl.verses', { n: 1 }).replace('1', 'N'), L('lbl.verses', { n: 2 }).replace('2', 'N'), `${id} has one form`);
  }
  setLocale('en');
  assert.throws(() => setLocale('xx'), /no strings for locale "xx"/);
});
