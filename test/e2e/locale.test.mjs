/**
 * The interface in another language, and the projects studio.
 *
 * Everything else in the browser suite runs in English on an English device,
 * so nothing there would notice a language that never took effect, a choice
 * that did not survive the restart it needs, or a date written in the
 * browser's language inside a different interface.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the interface follows the device, and the reader can choose', options, async (t) => {
  const app = await launch({ locale: 'nb-NO' });
  const { page } = app;
  t.after(() => app.close());
  const lang = () => page.evaluate(() => document.documentElement.lang);

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  assert.equal(await lang(), 'nb', 'a Norwegian device starts in Norwegian');
  assert.equal((await page.locator('.tabstrip .tab.is-active').innerText()).trim(), 'Velkommen');
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  assert.equal(await page.locator('.library-item .btn.soft').first().innerText(), 'Gjør tilgjengelig uten nett');

  await t.test('dates are written in the interface language', async () => {
    // The catalog's dates are the detail behind the Library's readout.
    const line = await page.locator('.lib-readout').getAttribute('title');
    // Norwegian writes 1.9.2026; the fixture catalog was updated 2026-09-01.
    assert.match(line, /1\.9\.2026/, `the catalog date is Norwegian: ${line}`);
  });

  await t.test('choosing Burmese restarts in Burmese, and it stays', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Innstillinger');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.settings');
    const reload = page.waitForEvent('load');
    await page.locator('.set-row', { hasText: 'Språk' }).locator('button', { hasText: 'မြန်မာ' }).click();
    await reload;
    await page.waitForSelector('#app .body-row');
    await page.waitForTimeout(800);
    assert.equal(await lang(), 'my');
    await page.reload();
    await page.waitForSelector('#app .body-row');
    assert.equal(await lang(), 'my', 'still Burmese after another restart');
    const stored = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      return new Promise((r) => { const q = db.transaction('settings').objectStore('settings').get('current'); q.onsuccess = () => r(q.result.locale); });
    });
    assert.equal(stored, 'my');
  });

  await t.test('the palette puts the exact title first', async () => {
    // Burmese starts "Export settings" with the word for Settings; the
    // exact title must still win.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('ဆက်တင်များ');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.modal-list .mi-t').first().innerText(), 'ဆက်တင်များ');
    await page.keyboard.press('Escape');
  });

  await t.test('back to the device language', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('ဆက်တင်များ');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.settings');
    const reload = page.waitForEvent('load');
    await page.locator('.set-row').first().locator('button').first().click();
    await reload;
    await page.waitForSelector('#app .body-row');
    assert.equal(await lang(), 'nb', 'the device language again');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});

test('projects are a studio', options, async (t) => {
  const app = await launch({ viewport: { width: 1600, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  const command = async (text) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  };

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });
  for (const ref of ['ps 23:1-3', 'gen 1:1', 'mat 5:3-5', 'exo 3:2']) await command(`project ${ref}`);
  // Room for the stage: both sidebars shut.
  await command('Left sidebar');
  await command('Right sidebar');
  await command('Projects');
  await page.waitForSelector('.doc.projects .pj-entry');

  const m = await page.evaluate(() => {
    const doc = document.querySelector('.doc.projects');
    const bar = doc.querySelector('.pj-bar');
    const stage = doc.querySelector('.pj-stage');
    const tops = [...doc.querySelectorAll('.pj-entry')].map((e) => Math.round(e.getBoundingClientRect().top));
    return {
      full: doc.classList.contains('doc-full'),
      barFirst: doc.firstElementChild === bar,
      hasSwitch: Boolean(bar.querySelector('.pj-switch')),
      hasName: Boolean(bar.querySelector('.pj-name')),
      stageScrolls: /auto|scroll/.test(getComputedStyle(stage).overflowY),
      entries: tops.length,
      firstRow: tops.filter((top) => top === tops[0]).length,
      foot: doc.lastElementChild.classList.contains('pj-progress'),
      shelfColumn: Boolean(doc.querySelector('.pj-shelf')),
    };
  });
  assert.ok(m.full, 'the page fills the work area');
  assert.ok(m.barFirst && m.hasSwitch && m.hasName, 'one band across the top: the switcher and the name');
  assert.ok(m.stageScrolls, 'the stage scrolls on its own');
  assert.equal(m.entries, 4);
  assert.ok(m.firstRow >= 2, `the entries use the width: ${m.firstRow} side by side`);
  assert.ok(m.foot, 'the counts are at the foot');
  assert.equal(m.shelfColumn, false, 'no column spent on the list of projects');

  await t.test('the switcher lists the projects and makes another', async () => {
    await page.locator('.pj-switch').click();
    const items = await page.locator('.menu .menu-item').allInnerTexts();
    assert.ok(items.some((text) => /4 passages/.test(text)), `the open project is listed with its size: ${items.join(' / ')}`);
    assert.equal(items.length, 3, 'one project, then New and Import');
    await page.locator('.menu .menu-item', { hasText: 'New project' }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.pj-entry').count(), 0, 'a new, empty project is open');
    assert.equal((await page.locator('.pj-switch-n').innerText()).trim(), '2', 'and the switcher counts two');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
