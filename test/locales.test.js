/**
 * Every interface locale says everything English says, in a shape L() can use.
 *
 * At run time a string missing from a locale would fall back to English and
 * nobody would notice until a reader met it; here it fails the build instead,
 * with the key and the locale named.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INTERFACE_LOCALES } from '../app/core/settings.js';
import { LOCALES, L, resolveLocale, setLocale } from '../app/shell/i18n.js';

const en = LOCALES.en.strings;
const others = Object.keys(LOCALES).filter((id) => id !== 'en');
// The set, not the count: '{n} verse|{n} verses' has {n} twice and a language
// with one plural form rightly writes it once.
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('the settings accept exactly the locales the interface has', () => {
  assert.deepEqual([...INTERFACE_LOCALES].sort(), Object.keys(LOCALES).sort());
});

for (const id of others) {
  const strings = LOCALES[id].strings;
  const plural = new Intl.PluralRules(id).resolvedOptions().pluralCategories;
  const singleForm = plural.length === 1;

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
  assert.equal(resolveLocale(null, ['my-MM']), 'my');
  assert.equal(resolveLocale(null, ['de-DE', 'my']), 'my');
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
  setLocale('my');
  assert.equal(L('lbl.verses', { n: 1 }).replace('1', 'N'), L('lbl.verses', { n: 2 }).replace('2', 'N'));
  setLocale('en');
  assert.throws(() => setLocale('xx'), /no strings for locale "xx"/);
});
