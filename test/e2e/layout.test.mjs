/**
 * Layout that only shows on a particular screen or window.
 *
 * The main suite runs at 1440×900 in a browser, where the app draws no title
 * bar of its own; neither a phone nor the desktop app's frameless window is
 * ever seen there. Both went wrong in ways a reader met at once: the Library
 * on a phone kept its desktop margins and a solid button on every row, and
 * the desktop band could fill with tabs until nothing was left to move the
 * window by.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

const firstRun = async (app) => {
  await app.open();
  await app.page.waitForSelector('.wl', { timeout: 20000 });
  await app.page.locator('.wl .btn.primary').click();
  await app.page.waitForSelector('.library-item', { timeout: 20000 });
  await app.page.waitForTimeout(500);
};

test('the Library on a phone', options, async (t) => {
  const app = await launch({ viewport: { width: 390, height: 844 }, phone: true });
  const { page } = app;
  t.after(() => app.close());
  await firstRun(app);

  const m = await page.evaluate(() => {
    const doc = getComputedStyle(document.querySelector('.doc'));
    const item = document.querySelector('.library-item[data-identify="kjv1611"]');
    const name = item.querySelector('strong');
    const button = item.querySelector('.library-actions .btn');
    return {
      padding: parseFloat(doc.paddingLeft),
      rowWidth: item.getBoundingClientRect().width,
      nameLines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
      solid: button.classList.contains('primary'),
      buttonHeight: button.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.ok(m.padding <= 20, `the page keeps a finger's margin, not the desktop's (${m.padding}px)`);
  assert.ok(m.rowWidth >= 390 * 0.85, `a row uses the width of the screen (${Math.round(m.rowWidth)}px of 390)`);
  assert.equal(m.nameLines, 1, 'a translation name is not squeezed onto two lines by its button');
  assert.equal(m.solid, false, 'a button repeated down the list is not a solid accent block');
  assert.ok(m.buttonHeight >= 36, `a button is big enough for a finger (${m.buttonHeight}px)`);
  assert.equal(m.overflow, false, 'nothing runs off the side');

  await t.test('a notice does not cover the bottom bar', async () => {
    await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
    const toast = page.locator('.toast').first();
    await toast.waitFor({ timeout: 60000 });
    const [a, b] = await Promise.all([toast.boundingBox(), page.locator('.mobile-bar').boundingBox()]);
    assert.ok(a.y + a.height <= b.y, `the notice ends (${Math.round(a.y + a.height)}) above the bar (${Math.round(b.y)})`);
  });

  await t.test('the first translation installed is the one in use at once', async () => {
    // Set only when a chapter was drawn, it stayed null while the reader was
    // still on the Library, and the card studio, the outline, search and the
    // exports all said no translation was available.
    await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    const current = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      const s = await new Promise((r) => { const q = db.transaction('settings').objectStore('settings').get('current'); q.onsuccess = () => r(q.result); });
      return s.translation;
    });
    assert.equal(current, 'kjv1611');
  });

  await t.test('asking for a pane by name shows it, drawer and all', async () => {
    // On a phone the sidebars are drawers; selecting a pane picked it inside a
    // shut drawer, so Bookmarks, Plan, a verse's note and "find" showed nothing.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Bookmarks');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => {
      const view = document.querySelector('.pane-view[data-view="marks"]');
      const r = view?.getBoundingClientRect();
      return {
        drawer: document.body.classList.contains('drawer-l'),
        active: view?.classList.contains('is-active') ?? false,
        onScreen: Boolean(r && r.width > 0 && r.right > 0 && r.left < innerWidth),
      };
    });
    assert.ok(shown.drawer, 'the left drawer opens');
    assert.ok(shown.active && shown.onScreen, 'with the Bookmarks pane in front, on screen');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});

test('the band of a window that draws its own title bar', options, async (t) => {
  const app = await launch({ viewport: { width: 1296, height: 820 } });
  const { page } = app;
  t.after(() => app.close());
  await firstRun(app);
  // What the desktop app sets on Windows and Linux (platform.frame 'overlay').
  await page.evaluate(() => { document.body.dataset.shell = 'on'; });
  const button = page.locator('[data-identify="kjv1611"] button', { hasText: 'Make available offline' });
  await button.click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });
  // The new-tab button makes the tab and opens the switcher over it to choose
  // a passage; Escape keeps the tab where it is.
  for (let i = 0; i < 12; i += 1) {
    await page.locator('.tabstrip .tab-new').click();
    await page.waitForSelector('.scrim:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.scrim:not([hidden])', { state: 'detached' });
  }
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const strip = document.querySelector('.tabstrip');
    const shown = [...strip.children].filter((k) => !k.hidden && k.getBoundingClientRect().width);
    const end = Math.max(...shown.map((k) => k.getBoundingClientRect().right));
    const regionOf = (el) => getComputedStyle(el).getPropertyValue('app-region') || getComputedStyle(el).getPropertyValue('-webkit-app-region');
    // The band is the handle; the strip sits in it and must not opt out.
    const region = regionOf(strip.closest('.band-drag')) === 'drag' && regionOf(strip) !== 'no-drag' ? 'drag' : regionOf(strip);
    return {
      free: Math.round(strip.getBoundingClientRect().right - end),
      region,
      hidden: [...strip.querySelectorAll('.tab')].filter((tab) => tab.hidden).length,
      more: !strip.querySelector('.tab-more').hidden,
    };
  });
  assert.ok(m.hidden > 0 && m.more, 'the tabs that do not fit go behind the overflow button');
  assert.ok(m.free >= 72, `the end of the strip is kept empty to move the window by (${m.free}px)`);
  assert.equal(m.region, 'drag', 'and that empty end is part of the drag handle');

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
