/**
 * An English Bible against the Hebrew where they number differently:
 * Malachi 4:1 in the KJV is Malachi 3:19 in the Westminster Leningrad Codex.
 * Both are real extracts (test/fixtures/originals), imported through the
 * Library as a reader would import them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { available, launch } from './harness.mjs';
import { root } from '../helpers.js';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('verses read across the two numberings', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.lib-tab[aria-selected="true"]');

  const importFile = async (name, identify) => {
    await page.locator('.lib-tab[data-page="more"]').click();
    await page.locator('.lib-src[data-source="file"]').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.lib-panel .btn.primary').click();
    await (await chooser).setFiles({ name, mimeType: 'text/xml', buffer: readFileSync(root(`test/fixtures/originals/${name}`)) });
    await page.waitForSelector('.fd');
    await page.locator('.fd-row[data-field="identify"] input').fill(identify);
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForSelector(`.library-item[data-identify="${identify}"]`, { timeout: 20000 });
  };
  const palette = async (text) => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };

  await importFile('wlc-mal3.osis.xml', 'wlc');
  await importFile('kjv-mal4.osis.xml', 'kjvmal');

  await t.test('the interlinear line under Malachi 4:1 is the Hebrew of 3:19', async () => {
    // Malachi 4 is only in the English Bible; the Hebrew has three chapters.
    await palette('mal 4');
    await page.waitForSelector('.crumb-tr');
    await page.locator('.crumb-tr').first().click();
    await page.locator('.modal-input').fill('kjvmal');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.chapter .vblock[data-verse="1"]');
    await palette('Interlinear line');
    const line = page.locator('.chapter .vblock[data-verse="1"] .ilin');
    await line.waitFor();
    // Hebrew 3:19 opens כִּֽי־הִנֵּה הַיּוֹם בָּא — "For, behold, the day cometh".
    const words = (await line.locator('.ilw-o').allInnerTexts()).map((w) => w.normalize('NFC'));
    assert.ok(words.some((w) => w.includes('הַיּוֹם'.normalize('NFC'))), `the day (${words.slice(0, 4)})`);
    assert.equal(await page.locator('.chapter .vblock[data-verse="6"] .ilin').count(), 1, 'and 4:6 has 3:24');
    await palette('Interlinear line');
  });

  await t.test('the word study says which Hebrew verse it read', async () => {
    await palette("Strong's numbers");
    await page.locator('.chapter .vblock[data-verse="1"] .strongs[data-codes~="H935"]').first().click();
    await page.locator('.pv-study').click();
    await page.waitForSelector('.ws-word');
    const caption = await page.locator('.ws-src').first().innerText();
    assert.match(caption, /4:1\s*=\s*3:19/, caption);
    assert.match(await page.locator('.ws-orig').first().innerText(), /\p{Script=Hebrew}/u);
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
