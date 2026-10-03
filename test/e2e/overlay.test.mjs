/**
 * Overlays: what the catalog repository lays over a translation without
 * being in its file (core/overlay.js). References that are not a draft come
 * with the translation; Strong's numbers that are a draft are offered, said
 * to be a draft, and added only when asked for; either can be taken off.
 * The fixtures carry both for the Burmese translation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch, openSidebars } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('overlays', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  const row = page.locator('[data-identify="judson1835"]');
  const fetched = (kind) => app.requests.filter((url) => url.endsWith(`/${kind}/judson1835.json`)).length;
  const clear = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((el) => el.remove()));
  const read = async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.vblock[data-verse="1"]');
  };
  const library = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
  };

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');

  await t.test('before it is downloaded, a translation says what draft it could have', async () => {
    await row.locator('[data-overlay="strongs"]').waitFor();
    assert.equal(await row.locator('[data-overlay="strongs"]').innerText(), "Strong's numbers available (draft)");
    assert.equal(await page.locator('[data-identify="kjv1611"] [data-overlay]').count(), 0, 'and one with none says nothing');
  });

  await t.test('installing brings the references and offers the draft without taking it', async () => {
    await row.locator('.library-actions .btn').click();
    await row.locator('.badge-ok').waitFor({ timeout: 60000 });
    assert.equal(fetched('refs'), 1, 'the references, which are not a draft, came with it');
    assert.equal(fetched('strongs'), 0, 'the draft was not fetched');
    const toast = page.locator('.toast.ok').last();
    assert.match(await toast.innerText(), /Add Strong's numbers \(draft\)/, 'offered in the message');
    assert.equal(await row.locator('[data-add="strongs"]').count(), 1, 'and on the row');
    await clear();
    await read();
    await openSidebars(page);
    const line = page.locator('.vblock[data-verse="2"] .xrefs').first();
    assert.match(await line.innerText(), /23:2/, 'verse 2 has the overlay\'s reference');
    assert.doesNotMatch(await page.locator('.vblock[data-verse="1"] .xrefs').first().innerText(), /1:1$/, 'verse 1 keeps the file\'s own');
  });

  await t.test('the draft is explained, added when confirmed, and shown', async () => {
    await library();
    await row.locator('[data-add="strongs"]').click();
    await page.waitForSelector('.confirm');
    assert.match(await page.locator('.confirm').innerText(), /no reader of the language has checked them/);
    await page.locator('.confirm .cf-acts .btn').last().click();
    await row.locator('.badge-draft').waitFor({ timeout: 60000 });
    assert.equal(fetched('strongs'), 1);
    assert.equal(await row.locator('.badge-draft').innerText(), "Strong's numbers: draft");
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => /1 verse .* was left as it is/.test(el.textContent)));
    await clear();
    await read();
    await page.waitForSelector('.vblock[data-verse="1"] .strongs');
    assert.equal(await page.locator('.vblock[data-verse="1"] .strongs').count(), 1, 'one word with a number; the particle beside it is not a link');
    assert.equal(await page.locator('.vblock[data-verse="1"] .strongs-code').first().innerText(), 'H7225');
    assert.equal(await page.locator('.vblock[data-verse="4"] .strongs').count(), 0, 'a verse whose text has changed is left alone');
    assert.doesNotMatch(await page.locator('.chapter').first().innerText(), /\{H\d/, 'no raw markup');
  });

  await t.test('the translation says where its numbers came from, and that they are a draft', async () => {
    await library();
    await row.locator('.lib-act[aria-haspopup="menu"]').click();
    await page.locator('.menu-item', { hasText: 'About' }).first().click();
    await page.waitForSelector('.tri-body');
    const info = await page.locator('.tri-body').innerText();
    assert.match(info, /Draft, not yet reviewed/);
    assert.match(info, /Open Scriptures Hebrew Bible \(CC BY 4\.0\)/);
    assert.match(info, /OpenBible\.info \(CC BY\)/);
    await page.keyboard.press('Escape');
  });

  await t.test('and they come off again, leaving the text as it was', async () => {
    await row.locator('.lib-act[aria-haspopup="menu"]').click();
    await page.locator('.menu-item', { hasText: "Remove Strong's numbers" }).click();
    await row.locator('[data-add="strongs"]').waitFor({ timeout: 60000 });
    assert.equal(await row.locator('.badge-draft').count(), 0);
    await clear();
    await read();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.chapter .strongs').count(), 0);
    assert.match(await page.locator('.vblock[data-verse="2"] .xrefs').first().innerText(), /23:2/, 'the references stay');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
