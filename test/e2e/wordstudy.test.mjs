/**
 * Word study, from the files a reader actually downloads: eBible.org's
 * browserBible zips of the Westminster Leningrad Codex and the KJV (trimmed
 * to a few chapters, test/fixtures/browserbible) and STEPBible's Hebrew
 * lexicon (an extract, test/fixtures/originals).
 *
 * Imported through the Library as a reader would, then studied from a
 * pressed word: the original word and its grammar, the lexicon entry, and
 * every word the translation uses for the number.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { available, launch } from './harness.mjs';
import { makeZip } from '../../app/services/zip.js';
import { root } from '../helpers.js';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

/** A fixture folder, zipped the way eBible.org ships it: one folder inside. */
async function zipOf(dir) {
  const base = root(`test/fixtures/browserbible/${dir}`);
  const files = [];
  const walk = (at, prefix) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(at, entry.name), `${prefix}${entry.name}/`);
      else files.push({ name: `${prefix}${entry.name}`, text: readFileSync(join(at, entry.name), 'utf8') });
    }
  };
  walk(base, `${dir}/`);
  return Buffer.from(await makeZip(files).arrayBuffer());
}

/** Stored notation, or a value that was never filled in, anywhere in a text. */
const LEAK = /\{[HG]\d|<S>\d|\bnull\b|\bundefined\b|\[object /;

test('word study from imported originals', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.lib-tab[aria-selected="true"]');

  const importFile = async (name, buffer, mimeType) => {
    await page.locator('.lib-tab[data-page="more"]').click();
    await page.locator('.lib-src[data-source="file"]').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.lib-panel .btn.primary').click();
    await (await chooser).setFiles({ name, mimeType, buffer });
  };
  const palette = async (text) => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  };
  const pane = page.locator('.ws');
  const section = (n) => pane.locator('.ws-sec').nth(n);

  await t.test('a browserBible zip is read, right to left and tagged', async () => {
    await importFile('heb_wlc_browserBible.zip', await zipOf('heb_wlc'), 'application/zip');
    await page.waitForSelector('.fd');
    assert.match(await page.locator('.fd').innerText(), /browserBible/);
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForSelector('.toast.ok, .toast:has-text("Strong")', { timeout: 20000 });
    await page.waitForSelector('.library-item[data-identify="wlc"]', { timeout: 20000 });
    await importFile('eng_kjv2006_browserBible.zip', await zipOf('eng_kjv2006'), 'application/zip');
    await page.waitForSelector('.fd');
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForSelector('.library-item[data-identify="kjv"]', { timeout: 20000 });
    const toasts = (await page.locator('.toast').allInnerTexts()).join('\n');
    assert.doesNotMatch(toasts, /expected|error|cannot/i, toasts);
  });

  await t.test("STEPBible's Hebrew lexicon is imported as a file", async () => {
    await importFile('TBESH.txt', readFileSync(root('test/fixtures/originals/tbesh-extract.txt')), 'text/plain');
    await page.waitForSelector('.toast:has-text("Hebrew lexicon")', { timeout: 10000 });
  });

  await t.test('in the Hebrew: the word, its grammar, the lexicon, its spellings', async () => {
    await palette('gen 1');
    await page.waitForSelector('.verse');
    // The first install is what opens; say which one this is.
    const showing = await page.locator('.crumb-tr').first().innerText();
    if (!/WLC/.test(showing)) {
      await page.locator('.crumb-tr').first().click();
      await page.locator('.modal-input').fill('WLC');
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    await palette("Strong's numbers");
    await page.locator('.chapter .strongs', { hasText: 'H1254' }).first().click();
    await page.locator('.pv-study').click();
    await page.waitForSelector('.ws-word');
    await page.waitForSelector('.ws-list');
    const original = await section(0).innerText();
    assert.match(original, /HVqp3ms/);
    assert.match(original, /Qal/, 'the code spelled out');
    assert.match(original, /Third Singular Masculine/);
    assert.equal(await section(0).locator('.ws-orig').getAttribute('dir'), 'rtl');
    assert.equal(await section(0).locator('.ws-hit').count(), 1, 'the word is marked in its verse');
    const lexicon = await section(1).innerText();
    assert.match(lexicon, /to create/);
    assert.match(lexicon, /H1254A, H1254B/, 'a plain number says which sense it is shown as');
    // A long entry is folded, and opens whole when asked.
    const fold = section(1).locator('.ws-fold');
    assert.equal(await fold.count(), 1);
    const folded = await section(1).locator('.ws-define').evaluate((el) => el.clientHeight);
    await fold.click();
    assert.ok(await section(1).locator('.ws-define').evaluate((el) => el.clientHeight) > folded, 'and opens');
    assert.match(await section(1).innerText(), /1c2\) to cut out/);
    assert.match(await pane.locator('.ws-head').innerText(), /ba\.ra/);
    const words = await section(2).locator('.ws-word-t').allInnerTexts();
    assert.equal(words.length, 2, `one entry a word, whatever its accents (${words})`);
    assert.doesNotMatch(await pane.innerText(), LEAK);
  });

  await t.test('a word opens its verses, and a verse opens in the text', async () => {
    await section(2).locator('.ws-sum').first().click();
    const refs = section(2).locator('.ws-item[open] .ws-ref');
    await refs.first().waitFor();
    const label = await refs.last().innerText();
    const verse = Number(/(\d+)\s*$/.exec(label)?.[1] ?? /^(\d+)/.exec(label.split(':').pop())?.[1]);
    await refs.last().click();
    await page.waitForSelector(`.vblock[data-verse="${verse}"] .verse.is-hit`, { timeout: 3000 });
  });

  await t.test('in the KJV: every number on a word is offered, and the study gathers the English', async () => {
    await page.locator('.crumb-tr').first().click();
    await page.locator('.modal-input').fill('KJV');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    // "created" carries H853 and H1254; both are shown, and either can be chosen.
    await page.waitForFunction(() => document.querySelector('.chapter .vblock[data-verse="1"] .strongs[data-codes="H853 H1254"] .strongs-code'));
    const created = page.locator('.chapter .vblock[data-verse="1"] .strongs[data-codes="H853 H1254"]').first();
    assert.equal(await created.locator('.strongs-code').innerText(), 'H853 H1254');
    await created.click();
    assert.equal(await page.locator('.pv-pick').count(), 2);
    await page.locator('.pv-pick', { hasText: 'H1254' }).click();
    assert.equal(await page.locator('.pv-pick[aria-pressed="true"]').innerText(), 'H1254');
    const popover = await page.locator('.popover:has(.pv-pick)').innerText();
    assert.match(popover, /to create/, 'the lexicon for the number chosen');
    assert.doesNotMatch(popover, LEAK);
    await page.locator('.pv-study').click();
    await page.waitForFunction(() => document.querySelector('.ws-code')?.textContent === 'H1254'
      && /KJV/.test(document.querySelectorAll('.ws-sec')[2]?.innerText ?? ''));
    await page.waitForSelector('.ws-word');
    assert.match(await section(0).locator('.ws-orig').innerText(), /\p{Script=Hebrew}/u, 'the Hebrew word, from the WLC on this device');
    await page.waitForSelector('.ws-list');
    const words = await section(2).locator('.ws-word-t').allInnerTexts();
    assert.ok(words.includes('created'), `“created” is one of them (${words})`);
    assert.doesNotMatch(await pane.innerText(), LEAK);
  });

  await t.test('the interlinear line: the Hebrew under each English verse, glossed', async () => {
    await palette('Interlinear line');
    await page.waitForSelector('.chapter .vblock[data-verse="1"] .ilin');
    const line = page.locator('.chapter .vblock[data-verse="1"] .ilin');
    assert.equal(await line.getAttribute('dir'), 'rtl');
    const first = line.locator('.ilw').first();
    assert.match(await first.locator('.ilw-o').innerText(), /\p{Script=Hebrew}/u);
    const glosses = await line.locator('.ilw-g').allInnerTexts();
    assert.ok(glosses.includes('to create'), `the lexicon's gloss for H1254 (${glosses})`);
    assert.ok(glosses.includes('H776') || glosses.length >= 6, 'a word with no entry here shows its number');
    // Inside the verse's text, so the list layout's two columns still hold.
    assert.equal(await page.locator('.chapter .vblock[data-verse="1"] .vtext .ilin').count(), 1);
    // A word in the line is pressed like a word in the text.
    await line.locator('.ilw', { hasText: 'to create' }).click();
    assert.match(await page.locator('.popover:has(.pv-study)').innerText(), /H1254/);
    await page.keyboard.press('Escape');
    assert.doesNotMatch(await page.locator('.chapter').first().innerText(), LEAK);
    await palette('Interlinear line');
    await page.waitForFunction(() => !document.querySelector('.ilin'));
  });

  await t.test('a Greek number with no Greek text says what to import', async () => {
    await palette('study G26');
    await page.waitForFunction(() => document.querySelector('.ws-code')?.textContent === 'G26');
    await page.waitForFunction(() => /Greek/.test(document.querySelector('.ws-sec')?.innerText ?? ''));
    const original = await section(0).innerText();
    assert.match(original, /No Greek text with Strong’s numbers/);
    assert.equal(await section(0).locator('button', { hasText: 'Open the Library' }).count(), 1);
    assert.match(await section(1).innerText(), /Greek lexicon is not on this device/);
  });

  await t.test('what is not a number is refused by name', async () => {
    await palette('study love');
    await page.waitForSelector('.toast:has-text("is not a Strong’s number")');
  });

  await t.test('the pane fits a phone', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await palette('study H1254');
    await page.waitForSelector('.ws-list');
    const overflow = await page.evaluate(() => {
      const ws = document.querySelector('.ws');
      if (!ws || !ws.offsetParent) return 'hidden';
      return [...ws.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.className).slice(0, 5);
    });
    assert.notEqual(overflow, 'hidden', 'the study opens on a phone too');
    assert.deepEqual(overflow, [], 'nothing runs off the screen');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await t.test('no script errors on the way', () => {
    assert.deepEqual(errors, []);
  });
});
