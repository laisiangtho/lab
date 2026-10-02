/**
 * The Library as a studio: a home that lists only what is here, and Get more,
 * which brings translations in from the catalog, getBible, eBible.org, a web
 * address or a file — and says which ones are already here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the Library', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  const tab = (id) => page.locator(`.lib-tab[data-page="${id}"]`);
  const src = (id) => page.locator(`.lib-src[data-source="${id}"]`);

  await t.test('with nothing here, it opens on Get more', async () => {
    assert.equal(await tab('more').getAttribute('aria-selected'), 'true');
    assert.equal(await src('catalog').getAttribute('aria-selected'), 'true');
    await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
    await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });
    assert.match(await page.locator('[data-identify="kjv1611"] .badge-ok').innerText(), /On this device/);
    assert.equal(await page.locator('[data-identify="kjv1611"] .library-actions .btn').count(), 0, 'and it offers no second download');
  });

  await t.test('the home lists only what is here', async () => {
    await tab('home').click();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.locator('.library-item').evaluateAll((rows) => rows.map((r) => r.dataset.identify)), ['kjv1611']);
    assert.match(await tab('home').innerText(), /1/);
    assert.ok(await page.locator('.library-item .lib-act[aria-haspopup="menu"]').isVisible(), 'with its menu');
  });

  await t.test('getBible: listed, marked when the same Bible is here, and brought in', async () => {
    await tab('more').click();
    await src('getbible').click();
    await page.waitForSelector('[data-identify="gb-web"]');
    assert.match(await page.locator('[data-identify="gb-kjv"]').innerText(), /Same as KJV on this device/, 'the catalog KJV is recognised');
    await page.locator('[data-identify="gb-web"] .library-actions .btn').click();
    await page.locator('[data-identify="gb-web"] .badge-ok').waitFor({ timeout: 30000 });
  });

  await t.test('eBible.org: a zip, right to left, brought in whole', async () => {
    await src('ebible').click();
    await page.waitForSelector('[data-identify="eb-hebwlc"]');
    await page.locator('[data-identify="eb-hebwlc"] .library-actions .btn').click();
    await page.locator('[data-identify="eb-hebwlc"] .badge-ok').waitFor({ timeout: 30000 });
    const dir = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      return new Promise((r) => { const q = db.transaction('translations').objectStore('translations').get('eb-hebwlc'); q.onsuccess = () => r(q.result?.info?.language?.textdirection); });
    });
    assert.equal(dir, 'rtl');
  });

  await t.test('the home now has three, each saying where it came from', async () => {
    await tab('home').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.library-item').count(), 3);
    assert.match(await page.locator('[data-identify="gb-web"]').innerText(), /getBible/);
  });

  await t.test('a web address imports through the same dialog as a file', async () => {
    await tab('more').click();
    await src('url').click();
    await page.locator('.lib-url input').fill('https://api.getbible.net/v2/web.json');
    await page.locator('.lib-url .btn').click();
    await page.waitForSelector('.fd');
    assert.equal(await page.locator('.fd-opt[aria-pressed="true"] .fd-opt-n').innerText(), 'getBible (JSON)');
    assert.equal(await page.locator('.fd-row[data-field="name"] input').inputValue(), 'World English Bible');
    await page.keyboard.press('Escape');
  });

  await t.test('the band never lets one tool slide under another, at any width', async () => {
    const collisions = () => page.evaluate(() => {
      const bar = document.querySelector('.lib-bar');
      const parts = [...bar.querySelectorAll('.lib-tab, .lib-src, .lib-find, .lib-readout, .lib-act')]
        .filter((el) => el.offsetParent && getComputedStyle(el).display !== 'none')
        .map((el) => ({ el, r: el.getBoundingClientRect() }));
      const out = [];
      for (let i = 0; i < parts.length; i += 1) {
        for (let j = i + 1; j < parts.length; j += 1) {
          const a = parts[i].r; const b = parts[j].r;
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
            out.push(`${parts[i].el.className} × ${parts[j].el.className}`);
          }
        }
        const r = parts[i].r; const box = bar.getBoundingClientRect();
        // On a phone the sources are a row that scrolls sideways: one past
        // the edge there is a chip to scroll to, not one that fell out.
        const scrolls = /auto|scroll/.test(getComputedStyle(parts[i].el.parentElement).overflowX);
        if (!scrolls && (r.right > box.right + 1 || r.left < box.left - 1)) out.push(`${parts[i].el.className} outside the band`);
      }
      return out;
    });
    for (const width of [1440, 1180, 980, 820, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const id of ['home', 'more']) {
        await tab(id).click();
        await page.waitForTimeout(250);
        assert.deepEqual(await collisions(), [], `${id} at ${width}px`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
