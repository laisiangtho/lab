/**
 * Four things done from a verse: compare it in every translation, send a link
 * to it, learn it by heart — and the reading that adds up to a streak.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('from a verse', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const { page } = app;
  t.after(() => app.close());
  const palette = async (text) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  const verseBar = async (n) => {
    await page.locator('.vnum').nth(n - 1).click();
    await page.waitForSelector('.vbar:not([hidden])');
  };

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  for (const id of ['kjv1611', 'ddb1931']) {
    await page.locator(`[data-identify="${id}"] .library-actions .btn`).click();
    await page.locator(`[data-identify="${id}"] .badge-ok`).waitFor({ timeout: 60000 });
  }
  await palette('gen 1');
  await page.waitForSelector('.vnum');

  await t.test('a verse in every translation on the device', async () => {
    await verseBar(3);
    await page.locator('.vbar button[title="Compare translations"]').click();
    await page.waitForSelector('.cmp-scrim:not([hidden]) .cmp-row');
    assert.match(await page.locator('.cmp-title').innerText(), /Genesis 1:3/);
    const rows = page.locator('.cmp-row');
    assert.equal(await rows.count(), 2, 'both translations');
    assert.equal(await rows.first().getAttribute('data-identify'), 'kjv1611', 'the one being read first');
    assert.match(await rows.nth(0).locator('.cmp-text').innerText(), /1:3/);
    assert.match(await page.locator('.cmp-count').innerText(), /2 of 2/);
    await page.locator('.cmp-step').last().click();
    await page.waitForTimeout(250);
    assert.match(await page.locator('.cmp-title').innerText(), /Genesis 1:4/, 'the arrow steps to the next verse');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    assert.match(await page.locator('.cmp-title').innerText(), /Genesis 1:3/, 'and the arrow key back');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('.cmp-scrim').isHidden());
  });

  await t.test('the palette compares too', async () => {
    await palette('compare jn 3:16');
    await page.waitForSelector('.cmp-scrim:not([hidden]) .cmp-row');
    assert.match(await page.locator('.cmp-title').innerText(), /John 3:16/);
    await page.keyboard.press('Escape');
  });

  await t.test('a link that opens on the verse', async () => {
    await palette('gen 1');
    await verseBar(5);
    await page.locator('.vbar button[title="Copy link"]').click();
    await page.waitForTimeout(300);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(link, /#\/1\/1\/5$/, link);
    await palette('ps 23');
    await page.goto(link);
    await page.waitForSelector('.verse');
    await page.waitForTimeout(1200);
    assert.match(await page.locator('.tabstrip .tab.is-active').innerText(), /Genesis 1/);
    const shown = await page.evaluate(() => {
      const el = document.querySelector('.vblock[data-verse="5"]');
      if (!el) return 'missing';
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight;
    });
    assert.equal(shown, true, 'verse 5 is on screen');
    assert.match(await page.evaluate(() => location.hash), /^#\/1\/1\/5$/, 'and stays in the address');
  });

  await t.test('a verse learned by heart', async () => {
    await page.locator('.vnum').nth(0).click();
    await page.waitForSelector('.vbar:not([hidden])');
    await page.locator('.vbar button[title="Memorize"]').click();
    await page.waitForTimeout(300);
    await palette('Memory verses');
    await page.waitForSelector('.mem-row');
    assert.match(await page.locator('.mem-row .mem-ref').innerText(), /Genesis 1:1/);
    assert.match(await page.locator('.doc-lede').innerText(), /1 verse · 1 due · 0 learned/);
    await page.locator('.mem-start').click();
    await page.waitForSelector('.mem-card');
    const gaps = await page.locator('.mem-gap').count();
    assert.ok(gaps >= 1, `some words are hidden (${gaps})`);
    await page.locator('.mem-gap').first().click();
    assert.equal(await page.locator('.mem-gap').count(), gaps - 1, 'a gap shows its word when pressed');
    await page.keyboard.press('Space');
    await page.waitForSelector('.mem-good');
    assert.equal(await page.locator('.mem-gap').count(), 0, 'Show shows the whole verse');
    await page.keyboard.press('3');
    await page.waitForSelector('.mem-finished');
    assert.match(await page.locator('.mem-finished').innerText(), /Done for now[\s\S]*tomorrow/);
    await page.locator('.mem-finished .btn').click();
    assert.match(await page.locator('.mem-due').innerText(), /tomorrow/);
    assert.match(await page.locator('.mem-box').getAttribute('title'), /Step 1 of 6/);
  });

  await t.test('half a minute on a chapter is a day read', async () => {
    await palette('ps 23');
    await page.waitForSelector('.verse');
    await page.waitForTimeout(31000);
    await palette('Plan');
    const stats = page.locator('.reading-stats');
    await stats.waitFor();
    const figures = await stats.locator('.rs-fig b').allInnerTexts();
    assert.equal(figures[0], '1', 'a one-day streak');
    assert.ok(Number(figures[1]) >= 1, 'a chapter this week');
    assert.match(await stats.locator('.rs-fig').first().innerText(), /day in a row/);
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
