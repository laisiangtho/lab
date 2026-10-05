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
    assert.equal(await tab('library').getAttribute('aria-current'), 'page', 'the Library, where the first run left off');
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

  await t.test('every page has the whole screen: it runs under the controls, and the bar gets out of its way', async () => {
    const off = () => page.evaluate(() => Number(document.body.style.getPropertyValue('--ph-off') || 0));
    const box = (selector) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }, selector);
    await tab('library').tap();
    await page.waitForSelector('.library-item');
    const scroller = await box('.leaf-scroll');
    assert.equal(scroller.top, 0, 'the page starts at the top of the screen');
    assert.equal(scroller.bottom, 844, 'and ends at its foot: no band is kept for the tab bar');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.lib-bar')).position), 'static', 'the Library\'s options are the top of the page, not a band over it');

    await tab('more').tap();
    await page.locator('.ph-screen .ph-row', { hasText: 'Data and formats' }).tap();
    await page.waitForSelector('.doc');
    assert.equal(await page.locator('h1.inline-title').isVisible(), false, 'a page\'s title is said once, by the controls over it');
    assert.deepEqual(await box('.leaf-scroll'), { top: 0, bottom: 844 });
    await page.waitForTimeout(500); // the page has arrived; what moves it now is the reader
    const moved = await page.evaluate(() => { const el = document.querySelector('.leaf-scroll'); el.scrollTop = 300; return el.scrollTop; });
    assert.equal(moved, 300, 'a long page');
    await page.waitForTimeout(400);
    assert.equal(await off(), 96, 'the tab bar gets out of the way here as it does over a chapter');
    assert.ok(await page.evaluate(() => document.body.classList.contains('ph-scrolled')), 'and the controls thin out');
    await page.evaluate(() => { document.querySelector('.leaf-scroll').scrollTop = 200; });
    await page.waitForTimeout(400);
    assert.equal(await off(), 0, 'and comes back on the way up');
    await page.locator('.ph-nav .ph-back').tap();
    await tab('read').tap();
    await page.waitForSelector('.leaf[data-pane="0"] .vblock');
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
    assert.equal(await tab('study').getAttribute('aria-current'), 'page', 'still under Study');
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
    assert.equal(await tab('read').getAttribute('aria-current'), 'page');
  });

  await t.test('Search and Library carry a large title; search waits for the Search key', async () => {
    await tab('library').tap();
    assert.equal(await page.locator('.ph-root-title').innerText(), 'Library');
    await tab('search').tap();
    assert.equal(await page.locator('.ph-root-title').innerText(), 'Search');
    const field = page.locator('.search-pane input[type="search"]').first();
    for (const [name, value] of [['autocorrect', 'off'], ['autocapitalize', 'off'], ['autocomplete', 'off'], ['enterkeyhint', 'search']]) {
      assert.equal(await field.getAttribute(name), value, name);
    }
    assert.ok(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize)) >= 16, 'big enough that the browser does not zoom');
    const run = () => page.locator('.search-pane').getAttribute('data-run');
    const before = await run();
    await field.fill('ordet');
    await page.waitForTimeout(700);
    assert.equal(await run(), before, 'typing moves nothing');
    await page.keyboard.press('Enter');
    await page.waitForFunction((was) => document.querySelector('.search-pane')?.dataset.run !== was, before);
    await page.locator('.sr-head').first().waitFor();
    assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'and the keyboard is put away');
  });

  await t.test('the results run under the controls, and the search field floats over them as the page moves', async () => {
    // Left by the test before: results for a word, books still folded.
    await page.evaluate(() => document.querySelectorAll('.sr-book:not(.is-open) > .sr-head').forEach((el) => el.click()));
    await page.waitForTimeout(300);
    await page.evaluate(() => [...document.querySelectorAll('.sr-chapter:not(.is-open) > .sr-head')].slice(0, 4).forEach((el) => el.click()));
    await page.locator('.result-line').first().waitFor();
    const scroller = '.leaf-pane > .pane-view > .pane-body';
    const at = (selector) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }, selector);
    const look = () => page.evaluate(() => { const s = getComputedStyle(document.querySelector('.search-pane .search-field')); return { radius: parseFloat(s.borderTopLeftRadius), glass: s.backdropFilter !== 'none' }; });
    assert.deepEqual(await at(scroller), { top: 0, bottom: 844 }, 'the page is the whole screen');
    await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; }, scroller);
    await page.waitForTimeout(500);
    const resting = await at('.search-pane .search-field');
    assert.ok(resting.top > 60, 'at the top the field sits under the large title');
    assert.equal((await look()).glass, false);

    await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 500; }, scroller);
    await page.waitForTimeout(600);
    const floating = await at('.search-pane .search-field');
    assert.ok(floating.top >= 0 && floating.top < 20, `the field stays under the top edge (${floating.top}px)`);
    const capsule = await look();
    assert.ok(capsule.glass && capsule.radius > 20, 'as a capsule of glass');
    assert.ok(await page.evaluate(() => document.querySelector('.result-line').getBoundingClientRect().top < 0), 'with the results gone under it');
    assert.equal(await page.evaluate(() => Number(document.body.style.getPropertyValue('--ph-off'))), 96, 'and the tab bar out of the way, as over a chapter');
    await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; }, scroller);
    await page.waitForTimeout(600);
    assert.deepEqual(await at('.search-pane .search-field'), resting, 'back where it was');
  });

  await t.test('the Library\'s filter comes down from the top once its heading has gone', async () => {
    await page.setViewportSize({ width: 390, height: 420 });
    await tab('library').tap();
    await page.locator('.lib-tab[data-page="more"]').tap();
    await page.waitForSelector('.library-item');
    const position = () => page.evaluate(() => getComputedStyle(document.querySelector('.lib-find')).position);
    assert.notEqual(await position(), 'fixed');
    const first = await page.evaluate(() => document.querySelector('.library-item').getBoundingClientRect().top);
    const moved = await page.evaluate(() => { const el = document.querySelector('.leaf-scroll'); el.scrollTop = 200; return el.scrollTop; });
    assert.ok(moved > 150, `a short screen, so the list scrolls (${moved}px)`);
    await page.waitForTimeout(500);
    assert.equal(await position(), 'fixed', 'the filter floats');
    assert.ok(await page.evaluate(() => document.querySelector('.lib-find').getBoundingClientRect().top < 20));
    assert.equal(await page.evaluate(() => document.querySelector('.library-item').getBoundingClientRect().top), first - moved, 'and the list has not jumped for it');
    await page.evaluate(() => { document.querySelector('.leaf-scroll').scrollTop = 0; });
    await page.waitForTimeout(500);
    assert.notEqual(await position(), 'fixed');
    await page.locator('.lib-tab[data-page="home"]').tap();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
  });

  await t.test('Settings: a list of sections, one at a time, without the desktop\'s frame', async () => {
    await tab('more').tap();
    await page.locator('.ph-screen .ph-row', { hasText: 'Settings' }).tap();
    await page.waitForSelector('.set-nav-item');
    assert.equal(await page.locator('.set-main').isVisible(), false, 'only the list at first');
    assert.match(await page.locator('.set-nav-item').first().innerText(), /Appearance/);
    await page.locator('.set-nav-item').first().tap();
    await page.waitForSelector('.set-section.is-open');
    assert.equal(await page.locator('.set-section:not(.is-open)').first().isVisible(), false);
    const text = await page.locator('.set-section.is-open').innerText();
    assert.match(text, /Theme/);
    assert.doesNotMatch(text, /Ribbon|Status bar/, 'nothing about a ribbon or a status bar');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'settings-h', 'focus is on the section opened');
    assert.equal(await page.locator('.ph-nav .ph-back').count(), 1, 'one Back button, the page\'s');
    await page.locator('.ph-nav .ph-back').tap();
    assert.ok(await page.locator('.set-nav').isVisible(), 'back to the list of sections first');
    assert.equal(await page.locator('.set-section.is-open').count(), 0);
    await page.locator('.ph-nav .ph-back').tap();
    await page.waitForSelector('.ph-screen:not([hidden])');
  });

  await t.test('a translation read alongside goes under each verse, and is taken away from the sheet', async () => {
    await tab('read').tap();
    await page.waitForSelector('.leaf[data-pane="0"] .vblock');
    await page.locator('.ph-tr').tap();
    await sheet.locator('.ph-row', { hasText: 'Read another alongside' }).tap();
    await page.waitForSelector('.verse-under');
    assert.equal(await page.locator('.leaf').count(), 1, 'one column');
    const under = page.locator('.vblock[data-verse="1"] .verse-under');
    assert.equal(await under.getAttribute('data-translation'), 'kjv1611');
    assert.match(await under.innerText(), /^KJV\s*\S/);
    await page.locator('.ph-tr').tap();
    await sheet.locator('[data-beside="kjv1611"]').tap();
    await page.waitForFunction(() => !document.querySelector('.verse-under'));
  });

  await t.test('a word studied comes up as a sheet over the reading', async () => {
    assert.match(await where(), / 1$/, 'Genesis 1, where History left the reading');
    await page.waitForSelector('.leaf[data-pane="0"] .strongs');
    await page.locator('.leaf[data-pane="0"] .strongs').first().tap();
    await page.locator('.popover button', { hasText: 'Study this word' }).tap();
    await sheet.waitFor();
    assert.equal(await page.locator('#ph-sheet-title').innerText(), 'Word study');
    await page.locator('.ph-sheet .ws').waitFor();
    assert.equal(await tab('read').getAttribute('aria-current'), 'page', 'still reading');
    assert.ok(await page.locator('.leaf[data-pane="0"] .vblock').first().isVisible(), 'the text is still there above it');
    assert.ok(await page.evaluate(() => document.querySelector('.ph-sheet').contains(document.activeElement)), 'focus is in the sheet');
    assert.ok(await page.evaluate(() => document.querySelector('.ph-tabs').inert && !document.querySelector('.ph-sheet').inert), 'and what is behind it is out of reach');
    const handle = page.locator('.ph-grab');
    assert.equal(await handle.getAttribute('aria-expanded'), 'false');
    await handle.press('Enter');
    assert.equal(await handle.getAttribute('aria-expanded'), 'true', 'the handle raises the sheet without a drag');
    assert.ok(await page.locator('.ph-sheet.is-full').count());
    await handle.press('Enter');
    assert.equal(await page.locator('.ph-sheet.is-full').count(), 0);
    await closeSheet();
    assert.equal(await page.locator('.ph-sheet .ws').count(), 0, 'and the pane goes back');
    assert.ok(await page.evaluate(() => document.querySelector('.ph-sheet').inert && !document.querySelector('.ph-tabs').inert), 'a sheet put away is out of reach itself');
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
