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

test('every page fits a phone, in the longest language', options, async (t) => {
  // Burmese runs longest and tallest of the interface languages, so a page that
  // fits in it fits in the others. A control is "cut" when an ancestor that
  // clips (overflow hidden, not a scroller) ends before it does — what a
  // choice running under a panel's rounded edge, or a toolbar button half off
  // the band, looks like to a reader.
  const { default: en } = await import('../../app/shell/locales/en.js');
  const { default: my } = await import('../../app/shell/locales/my.js');
  const app = await launch({ viewport: { width: 390, height: 844 }, phone: true, locale: 'my' });
  const { page } = app;
  t.after(() => app.close());
  const titleOf = (key) => my[key];

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });

  const pages = ['doc.library', 'doc.settings', 'doc.help', 'doc.shortcuts', 'doc.projects', 'proj.new', 'doc.cards', 'doc.notes', 'doc.board', 'doc.graph', 'doc.welcome'];
  for (const key of pages) assert.ok(en[key] && my[key], `${key} is a string in both`);

  const faults = [];
  for (const key of pages) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(titleOf(key));
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const found = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth}px)`);
      for (const el of document.querySelectorAll('#app button, #app input, #app select')) {
        const r = el.getBoundingClientRect();
        if (!r.width || r.top > innerHeight || r.bottom < 0 || el.closest('[hidden]')) continue;
        for (let p = el.parentElement; p && p.id !== 'app'; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (!/(hidden|clip)/.test(ps.overflowX) || /(auto|scroll)/.test(ps.overflowX)) continue;
          const pr = p.getBoundingClientRect();
          if (r.right > pr.right + 1 || r.left < pr.left - 1) {
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" cut by .${String(p.className).split(' ')[0]}`);
          }
          break;
        }
      }
      return out;
    });
    for (const fault of found) faults.push(`${en[key]}: ${fault}`);
  }
  assert.deepEqual(faults, []);
  assert.deepEqual(app.problems, []);
});

test('a wide window with both sidebars open leaves a narrow page', options, async (t) => {
  // 1024 px with both sidebars left the middle about 400 px. Pages laid out by
  // the window's width kept their desktop arrangement in it: Settings kept its
  // menu beside the settings and left them 130 px, the graph's buttons ran off
  // the pane, and the tab strip pushed its own new-tab button out of sight.
  const app = await launch({ viewport: { width: 1024, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await firstRun(app);
  await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });

  const cut = () => page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#app button, #app input')) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.top > innerHeight || r.bottom < 0 || el.closest('[hidden]')) continue;
      for (let p = el.parentElement; p && p.id !== 'app'; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (!/(hidden|clip)/.test(ps.overflowX) || /(auto|scroll)/.test(ps.overflowX)) continue;
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`${el.className} cut by ${p.className}`);
        break;
      }
    }
    return out;
  });
  const open = async (title) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(title);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  };

  const middle = await page.evaluate(() => document.querySelector('.leaf').getBoundingClientRect().width);
  assert.ok(middle < 520, `both sidebars are open and the page is narrow (${Math.round(middle)}px)`);
  for (const title of ['Settings', 'Cards', 'Link graph']) {
    await open(title);
    assert.deepEqual(await cut(), [], `${title}: nothing cut off`);
  }
  await open('Settings');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.set-layout')).gridTemplateColumns.split(' ').length), 1,
    'the settings menu goes above the settings, not beside them');
  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
