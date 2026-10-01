/**
 * A message stays while it is being read: with the pointer on it, and while
 * part of it is selected to be copied. Its words select like text.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('messages stay while they are read', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 800 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  // An ordinary message, as the shell sends one: "Strong's numbers: on" lives 3.5 s.
  const show = async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill("Strong's numbers");
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    return page.locator('.toast').last();
  };

  await t.test('left alone, it goes', async () => {
    const toast = await show();
    await toast.waitFor();
    await page.waitForTimeout(4200);
    assert.equal(await toast.count(), 0);
  });

  await t.test('with the pointer on it, it stays; off it, it goes', async () => {
    const toast = await show();
    await toast.hover();
    await page.waitForTimeout(5000);
    assert.equal(await toast.count(), 1, 'still there after its time');
    await page.mouse.move(5, 5);
    // It runs again from the time it had left when the pointer arrived.
    await page.waitForTimeout(4000);
    assert.equal(await toast.count(), 0, 'gone once the pointer left');
  });

  await t.test('its words can be selected and copied, and it waits while they are', async () => {
    const toast = await show();
    const words = toast.locator('span').last();
    assert.equal(await words.evaluate((el) => getComputedStyle(el).userSelect), 'text');
    await words.selectText();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(5000);
    assert.equal(await toast.count(), 1, 'kept while selected');
    assert.match(await page.evaluate(() => String(document.getSelection())), /Strong/);
    await page.evaluate(() => document.getSelection().removeAllRanges());
    await page.waitForTimeout(4000);
    assert.equal(await toast.count(), 0, 'gone once nothing is selected');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
