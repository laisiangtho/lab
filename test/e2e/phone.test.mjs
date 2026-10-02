/**
 * The phone shell: five places in a floating tab bar, the reading's controls
 * over the text, and everything chosen or done from a sheet. The desktop's
 * frame is not on screen at all; a window made wider gets it back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the phone shell', options, async (t) => {
  const app = await launch({ viewport: { width: 390, height: 844 }, phone: true });
  const { page } = app;
  t.after(() => app.close());
  const tab = (id) => page.locator(`.ph-tab[data-tab="${id}"]`);
  const sheet = page.locator('.ph-sheet.is-on');
  const closeSheet = async () => { await page.locator('.ph-done').tap(); await page.waitForFunction(() => !document.querySelector('.ph-sheet.is-on')); };
  const where = () => page.locator('.ph-where span').innerText();

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await installFromLibrary(page, 'kjv1611');
  await installFromLibrary(page, 'ddb1931');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((el) => el.remove()));

  await t.test('five places, and none of the desktop\'s frame', async () => {
    assert.deepEqual(await page.locator('.ph-tab').evaluateAll((els) => els.map((el) => el.dataset.tab)), ['read', 'search', 'library', 'study', 'more']);
    assert.equal(await tab('library').getAttribute('aria-selected'), 'true', 'the Library, where the first run left off');
    for (const part of ['.tabbar', '.ribbon', '.statusbar', '.mobile-bar', '.sidebar.left', '.leaf-head']) {
      assert.equal(await page.locator(part).first().isVisible(), false, `${part} is not on a phone`);
    }
    const names = await page.locator('.ph-tab').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    assert.deepEqual(names, ['Read', 'Search', 'Library', 'Study', 'More'], 'each tab has its name, for a screen reader');
    const size = await tab('read').boundingBox();
    assert.ok(size.height >= 44 && size.width >= 44, 'a tab is big enough for a finger');
  });

  await t.test('Read: the translation, the passage, text and the chapter\'s menu over the text', async () => {
    await tab('read').tap();
    await page.waitForSelector('.leaf[data-pane="0"] .vblock');
    assert.equal(await where(), 'Genesis 1');
    assert.ok(await page.locator('.ph-tr').isVisible() && await page.locator('.ph-aa').isVisible() && await page.locator('.ph-menu').isVisible());
    const text = await page.locator('.leaf[data-pane="0"] .note').boundingBox();
    assert.ok(text.width >= 388, 'the reading runs edge to edge');
  });

  await t.test('the passage opens a sheet of books; a chapter pressed goes there', async () => {
    await page.locator('.ph-where').tap();
    await sheet.waitFor();
    assert.equal(await page.locator('#ph-sheet-title').innerText(), 'Books');
    assert.equal(await page.locator('.ph-book.is-open').getAttribute('data-book'), '1', 'the book being read is open');
    assert.equal(await page.locator('.ph-chapters .is-here').innerText(), '1');
    await page.locator('.ph-book[data-book="19"] > .ph-row').tap();
    await page.locator('.ph-book[data-book="19"] .ph-chapters button').nth(22).tap();
    await page.waitForFunction(() => / 23$/.test(document.querySelector('.ph-where span')?.textContent ?? ''));
    assert.equal(await sheet.count(), 0, 'and the sheet is put away');
  });

  await t.test('a verse pressed opens its actions, each with its name', async () => {
    await page.locator('.leaf[data-pane="0"] .vnum').nth(1).tap();
    await sheet.waitFor();
    assert.equal(await page.locator('#ph-sheet-title').innerText(), 'Psalm 23:2');
    assert.equal(await page.locator('.vbar').isVisible(), false, 'not the desktop\'s popover');
    const names = await page.locator('.ph-act span').allInnerTexts();
    assert.ok(names.includes('Bookmark') && names.includes('Note') && names.includes('Copy verse'), names.join(', '));
    assert.equal(await page.locator('.leaf[data-pane="0"] .verse.is-selected').count(), 1, 'the verse is tinted while the sheet is up');
    await page.locator('.ph-dot[data-colour="green"]').tap();
    await page.waitForSelector('.leaf[data-pane="0"] .verse.is-marked[data-colour="green"]');
    assert.equal(await page.locator('.leaf[data-pane="0"] .verse.is-selected').count(), 0);
    await page.locator('.leaf[data-pane="0"] .vnum').nth(1).tap();
    await sheet.waitFor();
    assert.equal(await page.locator('.ph-dot[data-colour="green"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.ph-dot').first().tap();
    await page.waitForFunction(() => !document.querySelector('.leaf[data-pane="0"] .verse.is-marked'));
  });

  await t.test('the translation is changed from a sheet', async () => {
    await page.locator('.ph-tr').tap();
    await sheet.waitFor();
    assert.equal(await sheet.locator('.ph-row-check').count(), 1);
    await sheet.locator('.ph-row', { hasText: 'Det Danske Bibel' }).tap();
    await page.waitForFunction(() => document.querySelector('.leaf[data-pane="0"]')?.dataset.translation === 'ddb1931');
    assert.equal(await page.locator('.ph-pill').innerText(), 'Danske');
  });

  await t.test('the tab bar follows the scroll and settles; the controls thin out', async () => {
    const off = () => page.evaluate(() => Number(document.body.style.getPropertyValue('--ph-off') || 0));
    const scrollTo = (y) => page.evaluate((top) => { document.querySelector('.leaf[data-pane="0"] .leaf-scroll').scrollTop = top; }, y);
    await page.locator('.ph-where').tap();
    await page.locator('.ph-book[data-book="19"] .ph-chapters button').nth(118).tap();
    await page.waitForFunction(() => /119$/.test(document.querySelector('.ph-where span')?.textContent ?? ''));
    await page.waitForTimeout(300);
    await scrollTo(40);
    await page.waitForTimeout(40);
    assert.equal(await off(), 40, 'as far as the page has moved');
    assert.ok(await page.evaluate(() => document.body.classList.contains('ph-scrolled')));
    await page.waitForTimeout(400);
    assert.equal(await off(), 0, 'less than half way: back in');
    await scrollTo(400);
    await page.waitForTimeout(400);
    assert.equal(await off(), 96, 'further down: out of the way');
    await scrollTo(300);
    await page.waitForTimeout(400);
    assert.equal(await off(), 0, 'and back on the way up');
  });

  await t.test('a swipe turns the chapter', async () => {
    const swipe = (from, to) => page.evaluate(([x1, x2]) => {
      const el = document.querySelector('.panes');
      const touch = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(x1)], changedTouches: [touch(x1)], bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(x2)], bubbles: true }));
    }, [from, to]);
    await swipe(320, 60);
    await page.waitForFunction(() => /120$/.test(document.querySelector('.ph-where span')?.textContent ?? ''));
    await swipe(60, 320);
    await page.waitForFunction(() => /119$/.test(document.querySelector('.ph-where span')?.textContent ?? ''));
  });

  await t.test('Study and More list what the build has; a row opens full screen with a way back', async () => {
    await tab('study').tap();
    assert.equal(await page.locator('.ph-big').innerText(), 'Study');
    const rows = await page.locator('.ph-screen .ph-list').first().locator('.ph-row-t').allInnerTexts();
    assert.equal(rows[0], 'Bookmarks');
    assert.equal(new Set(rows).size, rows.length, `no name twice: ${rows.join(', ')}`);
    assert.ok((await page.locator('.ph-screen').innerText()).includes('Første Mosebog 1'), 'History has where the reading has been');
    await page.locator('.ph-screen .ph-row', { hasText: 'Bookmarks' }).tap();
    await page.waitForSelector('.ph-nav .ph-title');
    assert.equal(await page.locator('.ph-nav .ph-title').innerText(), 'Bookmarks');
    assert.equal(await tab('study').getAttribute('aria-selected'), 'true', 'still under Study');
    await page.locator('.ph-nav .ph-btn').first().tap();
    assert.equal(await page.locator('.ph-big').innerText(), 'Study', 'back to the list');
    await tab('more').tap();
    const more = await page.locator('.ph-screen .ph-row-t').allInnerTexts();
    assert.ok(more.includes('Settings') && more.includes('Guide') && more.includes('About'), more.join(', '));
    assert.ok(!more.includes('Shortcuts'), 'nothing about a keyboard');
  });

  await t.test('History takes the reading back', async () => {
    await tab('study').tap();
    await page.locator('.ph-screen .ph-row', { hasText: 'Første Mosebog 1' }).tap();
    await page.waitForFunction(() => document.querySelector('.ph-where span')?.textContent?.endsWith(' 1'));
    assert.equal(await tab('read').getAttribute('aria-selected'), 'true');
  });

  await t.test('a sheet is pulled down to put it away', async () => {
    await page.locator('.ph-menu').tap();
    await sheet.waitFor();
    await page.waitForTimeout(450); // the sheet arrives; its handle is measured once it has
    const grab = await page.locator('.ph-grab').boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 6);
    await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 160, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.ph-sheet.is-on'));
  });

  await t.test('nothing runs off the side, on any tab', async () => {
    for (const id of ['read', 'search', 'library', 'study', 'more']) {
      await tab(id).tap();
      await page.waitForTimeout(300);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(wide, false, `${id} fits`);
    }
  });

  await t.test('a window made wider gets the desktop\'s frame back', async () => {
    await tab('read').tap();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.ph-tabs').isVisible(), false);
    assert.ok(await page.locator('.tabbar').isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.ph-tabs').isVisible());
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
