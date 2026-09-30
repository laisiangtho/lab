/**
 * What survives closing the app and opening it again.
 *
 * The main suite runs in one uninterrupted session, so nothing in it ever saw
 * a second launch. Up to 26.09.29.17 the first launch recorded every pane as
 * "offered" without saving the arrangement it went with, and the second
 * launch then read every pane as switched off: both sidebars opened empty,
 * their buttons disabled. Installing or importing a translation and then
 * reopening the app was the ordinary way to meet it. Each check here reloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the app across a restart', options, async (t) => {
  const app = await launch();
  const { page } = app;
  t.after(() => app.close());

  const sidebars = () => page.evaluate(() => {
    const side = (name) => ({
      open: document.body.dataset[name] === 'open',
      panes: [...document.querySelectorAll(`.sidebar.${name} .pane-tab`)].map((p) => p.dataset.view),
      toggleDisabled: document.querySelector(`[data-side-toggle="${name}"]`)?.disabled ?? null,
    });
    return { left: side('left'), right: side('right') };
  });
  const stored = () => page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('settings').objectStore('settings').get('current'); q.onsuccess = () => r(q.result); });
  });
  const restart = async () => {
    await page.reload();
    await page.waitForSelector('#app .body-row');
    await page.waitForTimeout(800);
  };
  const install = (identify) => installFromLibrary(page, identify);

  let firstRun;

  await t.test('the first launch saves the arrangement it lays out', async () => {
    await app.open();
    await page.waitForSelector('.wl', { timeout: 20000 });
    await page.locator('.wl .btn.primary').click();
    await page.waitForSelector('.library-item', { timeout: 20000 });
    firstRun = await sidebars();
    assert.ok(firstRun.left.open && firstRun.left.panes.length > 0, 'the left sidebar opens with panes');
    assert.ok(firstRun.right.open && firstRun.right.panes.length > 0, 'the right sidebar opens with panes');
    const s = await stored();
    assert.deepEqual(s.sidebarLeft.flatMap((r) => r.views), firstRun.left.panes, 'the left arrangement is stored');
    assert.deepEqual(s.sidebarRight.flatMap((r) => r.views), firstRun.right.panes, 'the right arrangement is stored');
  });

  await t.test('installing a translation and reopening keeps both sidebars', async () => {
    await install('kjv1611');
    await restart();
    const after = await sidebars();
    assert.deepEqual(after.left.panes, firstRun.left.panes, 'the left sidebar has the same panes');
    assert.deepEqual(after.right.panes, firstRun.right.panes, 'the right sidebar has the same panes');
    assert.ok(after.left.open && after.right.open, 'and both are open');
  });

  await t.test('a pane put away stays away after a restart', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Tags pane');
    await page.waitForTimeout(250);
    assert.match(await page.locator('.modal-list .mi-t').first().innerText(), /Hide Tags pane/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await restart();
    const after = await sidebars();
    assert.ok(!after.left.panes.includes('tags'), 'the hidden pane is still hidden');
    assert.deepEqual(after.left.panes, firstRun.left.panes.filter((id) => id !== 'tags'), 'and the rest are where they were');
  });

  await t.test('an install left with empty sidebars by an earlier build recovers', async () => {
    // Exactly what 26.09.29.17 and earlier stored after a first launch: every
    // pane recorded as offered, no arrangement.
    await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      const store = () => db.transaction('settings', 'readwrite').objectStore('settings');
      const current = await new Promise((r) => { const q = store().get('current'); q.onsuccess = () => r(q.result); });
      const known = [...current.sidebarLeft, ...current.sidebarRight].flatMap((row) => row.views).concat(['tags']);
      await new Promise((r) => { const q = store().put({ ...current, sidebarLeft: [], sidebarRight: [], sidebarKnown: known }); q.onsuccess = r; });
    });
    await restart();
    const after = await sidebars();
    assert.deepEqual(after.left.panes, firstRun.left.panes, 'the left sidebar is laid out again');
    assert.deepEqual(after.right.panes, firstRun.right.panes, 'the right sidebar is laid out again');
    assert.ok(after.left.open && after.right.open, 'and both are open');
    await restart();
    assert.deepEqual((await sidebars()).left.panes, firstRun.left.panes, 'and it stays repaired');
  });

  await t.test('nothing went wrong on the way', () => {
    assert.deepEqual(app.problems, []);
  });
});
