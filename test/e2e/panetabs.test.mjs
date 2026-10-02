/**
 * A sidebar pane in a workspace tab: the same pane, moved, with whatever it
 * was showing; closed, it goes back to its sidebar; it comes back with the
 * session. On a narrow screen that asked for it, every pane opens this way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

const palette = async (page, text, pick = null) => {
  await page.keyboard.press('Control+p');
  await page.locator('.modal-input').fill(text);
  await page.waitForTimeout(250);
  if (pick) await page.locator('.modal-list .mi', { hasText: pick }).first().click();
  else await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
};

test('sidebar panes as workspace tabs', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 860 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await installFromLibrary(page, 'kjv1611');
  await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
  await page.waitForSelector('.verse');
  // Room in the strip for the tabs this test opens: the first run's Welcome
  // and Library go.
  for (const kind of ['welcome', 'library']) {
    const tab = page.locator(`.tabstrip .tab[data-kind="${kind}"]`);
    if (await tab.count()) await tab.locator('.t-close').click({ force: true });
  }
  await page.waitForTimeout(300);

  const sidebarPanes = (side) => page.locator(`.sidebar.${side} .pane-tab`).evaluateAll((tabs) => tabs.map((tab) => tab.dataset.view));

  await t.test('from the palette, the pane moves into a tab with what it was showing', async () => {
    await page.keyboard.press('Control+f');
    const field = page.locator('.search-pane input').first();
    await field.fill('beginning');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const pane = document.querySelector('.search-pane');
      return pane?.dataset.state === 'idle' && Number(pane.dataset.run) > 0;
    }, null, { timeout: 30000 });
    const found = await page.locator('.search-pane').getAttribute('data-run');
    const said = await page.locator('.search-pane .search-summary, .search-pane .sr-summary, .search-pane [data-summary]').first().innerText().catch(() => null);
    await palette(page, 'Open a pane as a tab', 'Open a pane as a tab');
    await page.locator('.modal-input').fill('Search');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:search"].is-active');
    assert.equal(await page.locator('.leaf-pane .search-pane').count(), 1, 'the pane is in the workspace');
    assert.equal(await page.locator('.sidebar .search-pane').count(), 0, 'and not in a sidebar as well');
    assert.equal(await page.locator('.leaf-pane .search-pane input').first().inputValue(), 'beginning', 'what was typed came with it');
    assert.equal(await page.locator('.search-pane').getAttribute('data-run'), found, 'and its results');
    assert.ok(!(await sidebarPanes('left')).includes('search'));
  });

  await t.test('switching tabs and back keeps it, still mounted', async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.verse');
    await page.locator('.tabstrip .tab[data-kind="pane:search"]').click();
    await page.waitForSelector('.leaf-pane .search-pane');
    assert.equal(await page.locator('.leaf-pane .search-pane input').first().inputValue(), 'beginning');
  });

  await t.test('a feature asking for its pane gets the tab', async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    // The chapter is on screen before the key is pressed: the press is the
    // reader's next act, not something racing the tab's own repaint.
    await page.waitForSelector('.tabstrip .tab[data-kind="chapter"].is-active');
    await page.waitForSelector('.leaf[data-pane="0"] .verse');
    await page.keyboard.press('Control+f');
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:search"].is-active');
  });

  await t.test('it comes back with the session', async () => {
    await page.reload();
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:search"]', { timeout: 20000 });
    await page.locator('.tabstrip .tab[data-kind="pane:search"]').click();
    await page.waitForSelector('.leaf-pane .search-pane');
    assert.ok(!(await sidebarPanes('left')).includes('search'), 'and not in its sidebar too');
  });

  await t.test('a document tab double-clicked detaches; a pane tab says why it cannot', async () => {
    await palette(page, 'Help');
    await page.waitForSelector('.tabstrip .tab[data-kind="help"].is-active');
    await page.locator('.tabstrip .tab[data-kind="help"]').dblclick();
    await page.waitForSelector('.float-win', { timeout: 3000 });
    assert.equal(await page.locator('.tabstrip .tab[data-kind="help"]').count(), 0, 'Help left the strip');
    await page.locator('.float-win .float-bar .tb-btn').first().click();
    await page.waitForSelector('.tabstrip .tab[data-kind="help"]');
    await page.locator('.tabstrip .tab[data-kind="pane:search"]').dblclick();
    await page.waitForSelector('.toast:has-text("close its tab")');
    assert.ok(await page.locator('.tabstrip .tab[data-kind="pane:search"]').count(), 'the pane stays in the strip');
  });

  await t.test('closing the tab puts it back in its sidebar', async () => {
    await page.locator('.tabstrip .tab[data-kind="pane:search"] .t-close').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.tabstrip .tab[data-kind="pane:search"]').count(), 0);
    assert.ok((await sidebarPanes('left')).includes('search'), 'search is back on the left');
    assert.equal(await page.locator('.sidebar .search-pane').count(), 1);
  });

  await t.test('a pane tab right-clicked offers to open it as a tab', async () => {
    await page.locator('.sidebar.left .pane-tab[data-view="search"]').click({ button: 'right' });
    await page.locator('.menu .mi, .menu button', { hasText: 'Open as a tab' }).first().click();
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:search"].is-active');
    await page.locator('.tabstrip .tab[data-kind="pane:search"] .t-close').click();
    await page.waitForTimeout(300);
  });

  await t.test('dragged onto the tab band, a pane opens as a tab', async () => {
    const from = await page.locator('.sidebar.left .pane-tab[data-view="search"]').boundingBox();
    const band = await page.locator('.tabbar').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2, { steps: 8 });
    assert.equal(await page.locator('.tabbar.is-pane-drop').count(), 1, 'the band shows it will take it');
    await page.mouse.up();
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:search"].is-active');
    await page.locator('.tabstrip .tab[data-kind="pane:search"] .t-close').click();
    await page.waitForTimeout(300);
  });

  await t.test('on a narrow screen that asked for it, every pane opens as a tab', async () => {
    await palette(page, 'Settings');
    await page.waitForSelector('.settings');
    const row = page.locator('.set-row', { hasText: 'Panes as tabs on narrow screens' });
    await row.scrollIntoViewIfNeeded();
    await row.locator('input[type="checkbox"], [role="switch"]').first().click();
    // A narrow window, not a phone: a phone has no sidebars to choose from.
    await page.setViewportSize({ width: 700, height: 844 });
    await page.waitForTimeout(500);
    await page.locator('.mobile-bar [data-mb="side.left"]').click();
    await page.locator('.menu .mi, .menu button', { hasText: 'Bookmarks' }).first().click();
    await page.waitForSelector('.tabstrip .tab[data-kind="pane:marks"].is-active');
    assert.equal(await page.locator('body.has-drawer').count(), 0, 'no drawer');
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.leaf-pane *')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length);
    assert.equal(overflow, 0, 'nothing runs off the screen');
    await page.setViewportSize({ width: 1280, height: 860 });
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
