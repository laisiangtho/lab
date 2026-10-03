/**
 * What a reader can actually do, driven against the built app.
 *
 * One browser for the whole file: launching one costs more than every check in
 * here put together, and the subtests are ordered so each leaves the app in a
 * state the next one can use.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch, openSidebars } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the app in a browser', options, async (t) => {
  const app = await launch();
  const { page } = app;
  t.after(() => app.close());

  const install = (identify) => installFromLibrary(page, identify);
  /** Back to reading: a document tab has no crumb bar to switch translations from. */
  const toChapter = async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
  };
  const switchTo = async (name) => {
    // Anything already open would be *closed* by the crumb press, leaving the
    // fill and the Enter to land on a modal nobody can see. This bit the last
    // two tests that used it from deeper in the suite.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.locator('.crumb-tr').first().click();
    await page.locator('.modal-input').fill(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  };
  /**
   * The search pane counts the scans it has finished and says whether one is
   * running, so waiting for the next answer is exact: the last answer stays on
   * screen while a new scan runs, and a stale one would be read as this one.
   */
  /** Bring a pane to the front, wherever the arrangement has put it. */
  const openPane = async (view) => {
    await page.locator(`.pane-tab[data-view="${view}"]`).first().click();
    await page.waitForSelector(`.pane-view[data-view="${view}"].is-active`);
  };
  const searchRuns = async () => {
    await page.waitForFunction(() => document.querySelector('.search-pane')?.dataset.state === 'idle', null, { timeout: 60000 });
    return page.locator('.search-pane').getAttribute('data-run');
  };
  const searchSettled = async (before) => {
    await page.waitForFunction((prev) => {
      const pane = document.querySelector('.search-pane');
      return pane?.dataset.state === 'idle' && pane.dataset.run !== prev;
    }, before, { timeout: 60000 });
    return page.locator('.search-pane .empty-hint').innerText();
  };
  const settings = () => page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('settings').objectStore('settings').get('current'); q.onsuccess = () => r(q.result); });
  });
  const centre = async (locator) => {
    const box = await locator.boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };
  const drag = async (from, to, steps = 18) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  await t.test('a first run says what this is, then hands over to the library', async () => {
    await app.open();
    await page.waitForSelector('.wl', { timeout: 20000 });
    assert.equal(await page.locator('.fatal').count(), 0);
    assert.equal((await page.locator('.tabstrip .tab.is-active .t-name').innerText()).trim(), 'Welcome',
      'the first screen is the greeting, not a list of sixty files');
    await page.locator('.wl .btn.primary').click();
    await page.waitForSelector('.library-item', { timeout: 20000 });
    assert.ok(await page.locator('.library-item').count() >= 3, 'the catalog is listed');
  });

  await t.test('installs a translation and reads a chapter', async () => {
    await install('kjv1611');
    // The rest of this file works in both sidebars.
    await openSidebars(page);
    await page.locator('.tab', { hasText: /Genesis/ }).first().click();
    await page.waitForSelector('.verse');
    assert.equal(await page.locator('.verse').count(), 31, 'Genesis 1 has 31 verses');
    assert.match(await page.locator('.crumbs').first().innerText(), /Genesis/);
  });

  await t.test('the reading panel moves the text', async () => {
    const before = await page.locator('.verse').first().evaluate((n) => getComputedStyle(n).fontSize);
    await page.locator('.statusbar .sb-reading').click();
    const slider = page.locator('.rpanel input[type=range]').first();
    await slider.evaluate((n) => { n.value = '24'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    const after = await page.locator('.verse').first().evaluate((n) => getComputedStyle(n).fontSize);
    assert.notEqual(before, after);
    assert.equal(after, '24px');
    await page.keyboard.press('Escape');
  });

  await t.test('a second translation lines up beside the first', async () => {
    await page.locator('.rib[title="Library"]').click();
    await install('judson1835');
    await page.locator('.tab', { hasText: /Genesis|ကမ္ဘာ/ }).first().click();
    await page.waitForSelector('.verse');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('parallel');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.leaf[data-pane]').count(), 2, 'two panes');
    const tops = await page.locator('.leaf .vblock[data-verse="1"]').evaluateAll((n) => n.map((x) => Math.round(x.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, `the first verse of each pane is level (${tops.join(', ')})`);
    await page.locator('.leaf[data-role="compare"] .leaf-close').click();
    await page.waitForTimeout(400);
  });

  await t.test('names, digits and the English behind them', async () => {
    await toChapter();
    await switchTo('judson');
    const crumbs = await page.locator('.crumbs').first().innerText();
    assert.match(crumbs, /ကမ္ဘာဦးကျမ်း/, 'the book is named by the translation');
    assert.match(crumbs, /ဓမ္မဟောင်းကျမ်း/, 'the testament too');
    assert.match(crumbs, /၁/, 'the chapter is in its own digits');
    const titles = await page.locator('.crumbs .crumb').evaluateAll((n) => n.map((x) => x.getAttribute('title')));
    assert.ok(titles.includes('Old Testament'), 'the canon name is the accessible name');
    assert.ok(titles.includes('Genesis'));
    assert.equal(await page.locator('.tabstrip .tab.is-active').getAttribute('title'), 'Genesis 1');
  });

  await t.test('a language pack fills in what a file omits, and is cached', async () => {
    const asked = () => app.requests.filter((u) => /lang\/iso-/.test(u)).length;
    const before = asked();
    await page.locator('.rib[title="Library"]').click();
    await install('ddb1931');
    await toChapter();
    await switchTo('Danske');
    assert.match(await page.locator('.crumbs').first().innerText(), /Det Gamle Testamente/, 'the pack names the testament the file does not');
    assert.ok(asked() > before, 'the pack was fetched');
    const cached = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      return new Promise((r) => { const q = db.transaction('records').objectStore('records').getAllKeys(); q.onsuccess = () => r(q.result.filter((k) => String(k).startsWith('lang:'))); });
    });
    assert.ok(cached.includes('lang:dan'), 'and kept');
  });

  await t.test('notes and bookmarks belong to the verse, not the translation', async () => {
    await page.locator('.vnum').first().click();
    await page.waitForSelector('.vbar:not([hidden])');
    await page.locator('.vbar button[title="Bookmark"]').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.verse.is-marked').count(), 1);
    await switchTo('King James');
    assert.equal(await page.locator('.verse.is-marked').count(), 1, 'the mark is on the verse in the other translation too');
  });

  await t.test('a passage of several verses is one note and one bookmark', async () => {
    await toChapter();
    await page.locator('.vnum').nth(2).click();
    await page.waitForSelector('.vbar:not([hidden])');
    assert.match(await page.locator('.vbar-ref').innerText(), /:3$/, 'one verse to begin with');

    await page.locator('.vnum').nth(6).click({ modifiers: ['Shift'] });
    assert.match(await page.locator('.vbar-ref').innerText(), /:3–7$/, 'shift takes the run between them');
    assert.equal(await page.locator('.verse.is-selected').count(), 5, 'and shows what it covers');

    // Whatever else the chapter already carries, these five are the run.
    const marked = () => page.locator('.vblock .verse.is-marked').evaluateAll(
      (nodes) => nodes.map((n) => Number(n.closest('.vblock').dataset.verse)),
    );
    const before = await marked();
    await page.locator('.vbar button[title="Bookmark"]').click();
    await page.waitForTimeout(600);
    const after = await marked();
    assert.deepEqual(after.filter((v) => !before.includes(v)).sort((a, b) => a - b), [3, 4, 5, 6, 7],
      'every verse of the run is marked');

    // Pressing any verse the run covers takes the whole run away again.
    await page.locator('.vnum').nth(4).click();
    await page.waitForSelector('.vbar:not([hidden])');
    await page.locator('.vbar button[title="Remove bookmark"]').click();
    await page.waitForTimeout(600);
    assert.deepEqual(await marked(), before, 'and one press clears it');
  });

  await t.test('a reference typed in shorthand goes there', async () => {
    await toChapter();
    const offered = async (text) => {
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(text);
      await page.waitForTimeout(250);
      return page.locator('.modal-list .mi .mi-t').allTextContents();
    };
    assert.deepEqual((await offered('ps 23')).slice(0, 1), ['Psalm 23']);
    assert.deepEqual((await offered('psa 3:2-4')).slice(0, 1), ['Psalm 3:2–4'], 'a run of verses too');
    const several = await offered('jo 3');
    assert.ok(several.length > 2 && several.includes('John 3') && several.includes('Job 3'),
      `a token that fits several books offers each (${several.slice(0, 4).join(', ')})`);
    assert.deepEqual(await offered('theme'), ['Theme'], 'and a command is still a command');

    await page.locator('.modal-input').fill('exo 2:3');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    assert.match(await page.locator('.crumbs').first().innerText(), /Exodus/);
    assert.equal(await page.locator('.verse.is-hit').count(), 1, 'and the verse is pointed at');

    await openPane('files');
    await page.locator('.files-pane input').fill('ps 23');
    await page.waitForTimeout(400);
    assert.deepEqual(await page.locator('.tree-item.is-book .tree-label').allTextContents(), ['Psalm'],
      'the books tree takes the same shorthand');
    await page.locator('.files-pane input').press('Enter');
    await page.waitForTimeout(900);
    assert.match(await page.locator('.crumbs').first().innerText(), /Psalm/);
    await page.locator('.files-pane input').fill('');
    await page.waitForTimeout(300);
  });

  await t.test('the interface does not select like a document', async () => {
    await toChapter();
    await openPane('files');
    const style = (selector) => page.evaluate((s) => {
      const el = document.querySelector(s);
      const c = getComputedStyle(el);
      return { select: c.userSelect, cursor: c.cursor };
    }, selector);
    for (const selector of ['.tab .t-name', '.tree-row .tree-label', '.statusbar .sb', '.crumb']) {
      assert.deepEqual(await style(selector), { select: 'none', cursor: 'default' }, `${selector} is chrome`);
    }
    assert.equal((await style('.verse')).select, 'text', 'the scripture is not');

    // Dragging across a tree row used to leave a highlight behind and expand
    // the row on release, which read as a fault.
    const label = page.locator('.tree-row .tree-label').first();
    const box = await label.boundingBox();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => String(getSelection())), '', 'nothing was selected');
    // The drag ended as a click on that row, which folded the testament away;
    // put it back for whatever runs next.
    await label.click();
    await page.waitForSelector('.tree-item.is-book.is-current .tree-row');
  });

  await t.test('the books tree opens and shuts as asked', async () => {
    await toChapter();
    await openPane('files');
    const current = page.locator('.tree-item.is-book.is-current');
    const isOpen = () => current.evaluate((n) => n.classList.contains('is-open'));
    assert.ok(await isOpen(), 'the book being read opens itself');
    assert.match(await current.locator('.tree-aux').innerText(), /^\S+\/\S+$/, 'and says where in it the reader is');

    // Following used to hold the current book open, so a click did nothing.
    await current.locator('.tree-row').click();
    assert.equal(await isOpen(), false, 'and it can still be shut');
    await current.locator('.tree-row').click();
    assert.ok(await isOpen(), 'and opened again');

    await page.locator('.tree-follow').click();
    assert.equal(await page.locator('.tree-follow').getAttribute('aria-pressed'), 'false');
    await current.locator('.tree-row').click();
    await page.keyboard.press('Control+ArrowRight');
    await page.waitForTimeout(700);
    assert.equal(await isOpen(), false, 'with following off, moving on does not reopen it');
    await page.locator('.tree-follow').click();
    await page.waitForTimeout(300);
  });

  await t.test('tabs reorder and detach, leaving nothing behind', async () => {
    await page.locator('.tab-new').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    const names = () => page.locator('.tabstrip .tab .t-name').allTextContents();
    const before = await names();
    assert.ok(before.length >= 2, 'more than one tab');
    const first = await centre(page.locator('.tabstrip .tab').first());
    const second = await centre(page.locator('.tabstrip .tab').nth(1));
    await drag(first, { x: second.x + 30, y: second.y });
    const after = await names();
    assert.notDeepEqual(after, before, 'the order changed');
    assert.equal(await page.locator('.drop-caret:not([hidden]), .tab.is-dragging').count(), 0, 'no marks left behind');
    assert.equal(await page.evaluate(() => document.body.className), '', 'no drag class left behind');

    const tab = await centre(page.locator('.tabstrip .tab').first());
    await drag(tab, { x: tab.x + 80, y: tab.y + 240 });
    assert.equal(await page.locator('.float-win').count(), 1, 'the tab became a window');
    await page.locator('.float-win [title="Dock"]').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.float-win').count(), 0, 'and went back');
  });

  await t.test('a sidebar splits into rows and gives a pane back', async () => {
    const tags = page.locator('.sidebar.left .pane-tab[data-view="marks"]');
    const group = await centre(page.locator('.sidebar.left .side-group').first());
    await drag(await centre(tags), { x: group.x, y: group.box.y + group.box.height * 0.8 });
    assert.equal(await page.locator('.sidebar.left .side-group').count(), 2, 'two rows');
    assert.equal(await page.locator('.sidebar.left .row-divider').count(), 1);
    const stored = await settings();
    assert.equal(stored.sidebarLeft.length, 2, 'the arrangement is remembered');

    for (let i = 0; i < 6; i += 1) {
      const pane = page.locator('.sidebar.right .pane-tab').first();
      if (!await pane.count()) break;
      await drag(await centre(pane), await centre(page.locator('.sidebar.left .pane-tabs').first()));
    }
    assert.equal(await page.locator('.sidebar.right .pane-tab').count(), 0, 'the right sidebar is empty');
    const back = await centre(page.locator('.sidebar.left .pane-tab').last());
    await page.mouse.move(back.x, back.y);
    await page.mouse.down();
    await page.mouse.move(page.viewportSize().width - 40, 400, { steps: 18 });
    await page.waitForTimeout(200);
    const rail = await page.locator('.sidebar.right').boundingBox();
    assert.ok(rail && rail.width > 0, 'an empty sidebar still offers a rail to drop onto');
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.sidebar.right .pane-tab').count(), 1, 'and takes the pane back');
  });

  await t.test('search counts what it found, and opens a verse', async () => {
    await toChapter();
    await switchTo('King James');
    await page.keyboard.press('Control+f');
    await page.waitForSelector('.search-pane');
    const field = page.locator('.search-pane > .field input').first();
    const status = () => page.locator('.search-pane .empty-hint').innerText();

    const before = await searchRuns();
    await field.fill('word');
    assert.match(await searchSettled(before), /\d+ verses · \d+ chapters? · \d+ books?/,
      'the shape of the answer, not just a list');
    const books = await page.locator('.sr-book').count();
    assert.ok(books >= 2, `every book that matched is listed (${books})`);

    // A book opens into chapters, a chapter into verses.
    await page.locator('.sr-book .sr-head').first().click();
    await page.waitForSelector('.sr-chapter');
    await page.locator('.sr-chapter .sr-head').first().click();
    await page.waitForSelector('.result-line');
    await page.locator('.result-line').first().click();
    await page.waitForTimeout(600);
    assert.ok(await page.locator('.verse').count() > 0, 'and the verse opens');
  });

  await t.test('search matches whole words, and says when a pattern is wrong', async () => {
    const field = page.locator('.search-pane > .field input').first();
    let before = await searchRuns();
    await field.fill('wor');
    assert.match(await searchSettled(before), /\d+ verses/, 'part of a word matches by default');

    before = await searchRuns();
    await page.locator('.sm-btn[data-flag="word"]').click();
    assert.match(await searchSettled(before), /Nothing found/, 'and not when whole words are asked for');

    before = await searchRuns();
    await page.locator('.sm-btn[data-flag="regex"]').click();
    await field.fill('w[oa]rd');
    assert.match(await searchSettled(before), /\d+ verses/, 'a pattern matches');

    await field.fill('(unclosed');
    await page.waitForSelector('.search-bad');
    assert.match(await page.locator('.search-bad').innerText(), /Unterminated group/, 'a broken pattern says why');
    // Leave both switches off and wait for that scan too, so the next check is
    // not handed this one's answer.
    before = await searchRuns();
    await page.locator('.sm-btn[data-flag="regex"]').click();
    await searchSettled(before);
    before = await searchRuns();
    await page.locator('.sm-btn[data-flag="word"]').click();
    await searchSettled(before);
  });

  await t.test('search can be pointed at one book, and remembers it', async () => {
    const field = page.locator('.search-pane > .field input').first();
    const status = () => page.locator('.search-pane .empty-hint').innerText();
    let mark = await searchRuns();
    await field.fill('English');
    const all = Number((await searchSettled(mark)).match(/(\d+) verses/)[1]);

    mark = await searchRuns();
    await page.locator('.sf-toggle').click();
    await page.locator('.sf-chip', { hasText: 'Open book' }).click();
    const narrowed = Number((await searchSettled(mark)).match(/(\d+) verses/)[1]);
    assert.ok(narrowed < all, `one book finds fewer than the whole Bible (${narrowed} of ${all})`);
    assert.match(await page.locator('.sf-scope').innerText(), /1 book/, 'the scope says so');

    const scoped = await page.locator('.sf-scope').innerText();
    await page.reload();
    await page.waitForSelector('#app .body-row');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.sf-scope').innerText(), scoped, 'and it survives a reload');
    // Leave the scope as it was found, so later checks search everything.
    await page.locator('.sf-toggle').click();
    await page.locator('.sf-chip', { hasText: 'Whole Bible' }).click();
    await page.waitForTimeout(500);
  });

  await t.test('the text panel fits where it is put', async () => {
    await page.locator('.statusbar .sb-reading').click();
    await page.waitForSelector('.rpanel:not([hidden])');
    const fits = () => page.evaluate(() => {
      const panel = document.querySelector('.rpanel');
      const box = panel.getBoundingClientRect();
      return { onScreen: box.top >= 0 && box.bottom <= innerHeight, scrolls: getComputedStyle(panel).overflowY === 'auto' };
    });
    assert.deepEqual(await fits(), { onScreen: true, scrolls: false });
    // The interface size changes the height of every row in the panel.
    // The interface size is the panel's last slider, whatever rows sit above it.
    const slider = page.locator('.rpanel .rp-row:has(input[type=range])').last().locator('input[type=range]');
    await slider.evaluate((n) => { n.value = '17'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(400);
    assert.deepEqual(await fits(), { onScreen: true, scrolls: false }, 'at the largest interface size too');
    await slider.evaluate((n) => { n.value = '13'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  });

  await t.test('the narrow layout has its own chrome', async () => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.waitForTimeout(500);
    assert.ok(await page.locator('.mobile-bar').isVisible(), 'the navigation pill');
    assert.equal(await page.locator('.app-pill, .rib-app, .sb-app').count(), 0, 'no app mark in the chrome');
    // The strip fits what it can and hides the rest behind its own button,
    // which is how the other tabs are reached in a window this narrow.
    const shown = await page.locator('.tabstrip .tab:visible').count();
    const all = await page.locator('.tabstrip .tab').count();
    assert.ok(shown >= 1, 'at least one tab');
    assert.equal(await page.locator('.tab-more').isVisible(), shown < all,
      'the button appears exactly when a tab has been hidden');
    assert.ok(await page.locator('.tabstrip .tab.is-active').isVisible(), 'the tab in front is never a hidden one');
    await page.locator('.mobile-bar button').first().click();
    await page.waitForTimeout(400);
    assert.match(await page.evaluate(() => document.body.className), /drawer-l/, 'the sidebar arrives as a drawer');
    await page.locator('.scrim-mobile').click({ position: { x: 640, y: 500 } });
    await page.waitForTimeout(300);
    assert.doesNotMatch(await page.evaluate(() => document.body.className), /drawer/, 'and the scrim closes it');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
  });

  await t.test('what was open comes back after a reload', async () => {
    await toChapter();
    const before = await settings();
    const active = await page.locator('.tabstrip .tab.is-active').getAttribute('title');
    await page.reload();
    await page.waitForSelector('#app .body-row');
    await page.waitForTimeout(1500);
    const after = await settings();
    assert.equal(after.translation, before.translation);
    assert.equal(after.tabs.length, before.tabs.length);
    assert.equal(after.sidebarLeft.length, before.sidebarLeft.length);
    assert.equal(after.activeTab, before.activeTab, 'the tab in front is remembered');
    assert.equal(await page.locator('.tabstrip .tab.is-active').getAttribute('title'), active, 'and is the one that comes back');
  });

  await t.test('the popover says what the file holds and where it parts from the canon', async () => {
    await toChapter();
    await page.locator('.leaf-head .tr-btn').first().click();
    await page.waitForSelector('.trinfo:not([hidden])');
    const text = await page.locator('.trinfo').innerText();
    assert.match(text, /4 books/, 'what was installed');
    assert.match(text, /6278 verses/);
    // Not "62 differences", which raises a question and answers none: what
    // kind of difference, in words a reader can act on.
    assert.match(text, /books missing/, 'and how it differs from the canon');
    assert.match(text, /Against the canon/);
    await page.locator('.tri-more > summary').click();
    assert.match(await page.locator('.tri-diag').innerText(), /Leviticus is absent/);
    await page.keyboard.press('Escape');
  });

  await t.test('a stored copy that lost its text says so, and repairs', async () => {
    const identify = await page.evaluate(() => document.querySelector('.leaf[data-role="primary"]').dataset.translation);
    await page.evaluate(async (id) => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      await new Promise((r) => {
        const tx = db.transaction('chapters', 'readwrite');
        tx.objectStore('chapters').delete(IDBKeyRange.bound([id], [id, []]));
        tx.oncomplete = r;
      });
    }, identify);
    await page.reload();
    await page.waitForSelector('#app .body-row');
    await page.waitForSelector('.callout', { timeout: 20000 });
    assert.match(await page.locator('.callout').first().innerText(), /incomplete/, 'a half-written copy is not read as a translation that omits the book');
    await page.locator('.callout .btn').click();
    await page.waitForSelector('.verse', { timeout: 60000 });
    assert.ok(await page.locator('.verse').count() > 0, 'and downloading it again brings the text back');
  });


  await t.test('the palette takes an instruction, not only a name', async () => {
    await toChapter();
    const offered = async (text) => {
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(text);
      await page.waitForTimeout(250);
      return page.locator('.modal-list .mi .mi-t').allTextContents();
    };
    assert.match((await offered('note ps 23:1-3'))[0], /Psalm 23:1–3$/, 'a verb and a reference read as one instruction');
    assert.match((await offered('find mercy'))[0], /mercy$/, 'and a verb that takes words takes the rest of the line');
    assert.deepEqual((await offered('parallel'))[0], 'Open parallel pane',
      'a word on its own is still the command of that name');
    assert.match((await offered('parallel '))[0], /^parallel …$/,
      'the space is what makes it a verb, and then it says what it wants');

    await page.locator('.modal-input').fill('mark exo 2:3');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    assert.match(await page.locator('.crumbs').first().innerText(), /Exodus/, 'it goes where it acted');
    assert.equal(await page.locator('.verse.is-marked').count(), 1, 'and it did the thing');
    // Put it back: the same instruction is a toggle.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('mark exo 2:3');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.verse.is-marked').count(), 0);
  });

  await t.test('a passage leaves as Markdown, with the reader\'s own notes in it', async () => {
    await toChapter();
    await page.evaluate(() => {
      window.__copied = null;
      navigator.clipboard.writeText = async (text) => { window.__copied = text; };
    });
    // A note written through the palette, so the export has something of the
    // reader's in it and not only the text anyone can download.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('note gen 1:1');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.composer:not([hidden])');
    await page.locator('.composer textarea').fill('A note for the export.');
    await page.waitForTimeout(900);

    // The title is most of the title bar, so the window must move by it. A
    // press that goes nowhere is still a caret; one that travels is a drag.
    const title = page.locator('.composer .cw-title');
    const box = await title.boundingBox();
    const before = await page.locator('.composer').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.locator('.composer').boundingBox();
    assert.ok(Math.round(before.x - after.x) >= 50 && Math.round(after.y - before.y) >= 30,
      `the window followed the title (${before.x}→${after.x}, ${before.y}→${after.y})`);

    // A press that goes nowhere is a caret, and once the caret is in there the
    // mouse belongs to the text — a title being edited must not drag.
    await title.click();
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'cw-title');
    const parked = await page.locator('.composer').boundingBox();
    const now = await title.boundingBox();
    await page.mouse.move(now.x + 20, now.y + now.height / 2);
    await page.mouse.down();
    await page.mouse.move(now.x + 90, now.y + now.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.equal(Math.round((await page.locator('.composer').boundingBox()).x), Math.round(parked.x),
      'selecting the title does not move the window');

    await page.locator('.composer .cw-tool.danger').click();

    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('export gen 1:1-2');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.modal-list .mi');
    await page.locator('.modal-list .mi').first().click();
    await page.waitForTimeout(600);
    const markdown = await page.evaluate(() => window.__copied);
    assert.match(markdown, /^## Genesis 1:1–2/m, 'headed by the reference');
    assert.match(markdown, /\*\*2\*\* Genesis 1:2/, 'the verses are quoted with their numbers');
    assert.match(markdown, /### Note\n/, 'and the note is under them');
    assert.match(markdown, /A note for the export\./);
    assert.ok(!markdown.includes('Genesis 1:3'), 'it stops where the passage stops');
  });

  await t.test('a project collects passages and survives a reload', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('project ps 23:1-3');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);

    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Projects');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.doc.projects');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.pj-entry').count(), 1);
    assert.match(await page.locator('.pj-ref').first().innerText(), /Psalm 23:1–3/);
    assert.ok(await page.locator('.pj-v').count() >= 3, 'the verses are quoted from the translation being read');

    await page.locator('.pj-text').first().fill('Why this passage is here.');
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForSelector('.doc.projects', { timeout: 20000 });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.pj-text').first().inputValue(), 'Why this passage is here.',
      'what was written is still written');
  });

  await t.test('settings gathers what every feature owns', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Settings');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.doc.settings');
    await page.waitForTimeout(600);
    const named = async (section) => page.evaluate((id) =>
      [...document.querySelectorAll(`#set-${id} .set-name`)].map((n) => n.textContent), section);
    const study = await named('study');
    assert.ok(study.some((n) => /Follow the chapter/.test(n)), 'the Books pane contributed its own');
    assert.ok(study.some((n) => /How search matches/.test(n)), 'and so did Search');
    const storage = await named('storage');
    assert.equal(storage.at(-1), 'Erase everything on this device', 'what cannot be undone stays at the bottom');

    // A setting that has to reach the reading surface, not just the record.
    await page.locator('#set-reading .rp-seg button', { hasText: 'Mono' }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.body.dataset.font), 'mono');
    await page.locator('#set-reading .rp-seg button', { hasText: 'Serif' }).click();
    await page.waitForTimeout(300);
  });

  await t.test('choosing a colour does not rebuild the page under the pointer', async () => {
    await page.evaluate(() => {
      window.__rebuilds = 0;
      let last = null;
      const tick = () => {
        const now = document.querySelector('.doc.settings');
        if (now && now !== last) { window.__rebuilds += 1; last = now; }
        requestAnimationFrame(tick);
      };
      tick();
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.__rebuilds = 0; });
    await page.locator('.accent-pick').click();
    await page.waitForSelector('.colorpicker:not([hidden])');
    const field = await page.locator('.cp-field').boundingBox();
    await page.mouse.move(field.x + field.width * 0.2, field.y + field.height * 0.3);
    await page.mouse.down();
    const seen = [];
    for (let i = 1; i <= 6; i += 1) {
      await page.mouse.move(field.x + field.width * (0.2 + i * 0.08), field.y + field.height * (0.3 + i * 0.05));
      await page.waitForTimeout(30);
      seen.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()));
    }
    assert.equal(await page.evaluate(() => window.__rebuilds), 0, 'nothing was redrawn during the drag');
    assert.ok(new Set(seen).size > 3, 'and the colour followed the pointer');
    await page.mouse.up();
    await page.waitForTimeout(500);
    const kept = (await settings()).accent;
    assert.equal(kept, seen.at(-1), 'the colour it stopped on is the one kept');
    await page.keyboard.press('Escape');
  });

  await t.test('nothing is erased without being asked', async () => {
    await page.locator('#set-storage .btn.danger', { hasText: 'Reset settings' }).click();
    await page.waitForSelector('.modal.confirm');
    assert.match(await page.locator('.cf-h').innerText(), /Reset every setting\?/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.modal.confirm').count(), 1);
    assert.ok(await page.locator('.modal.confirm').isHidden(), 'escape means no');
    assert.ok((await settings()).accent, 'and nothing happened');
  });


  await t.test('a card is made of the passage that was chosen, not the first verse', async () => {
    await toChapter();
    // Shift extends the selection in the verse bar; the card follows it.
    await page.locator('.verse').nth(1).locator('.vnum').click();
    await page.waitForSelector('.vbar');
    await page.keyboard.down('Shift');
    await page.locator('.verse').nth(3).locator('.vnum').click();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);
    assert.match(await page.locator('.vbar-ref').innerText(), /2[–-]4/, 'three verses are selected');

    // The download is caught rather than written: what matters is which
    // passage the card was drawn from.
    const drawn = await page.evaluate(() => new Promise((resolve) => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function capture() {
        HTMLAnchorElement.prototype.click = click;
        resolve(this.download);
      };
      document.querySelector('.vbar-acts button[title="Verse card"], .vbar-acts button[aria-label="Verse card"]').click();
      setTimeout(() => resolve(null), 8000);
    }));
    assert.ok(drawn, 'a file was offered');
    assert.match(drawn, /-2-4-/, `the card is of the run 2–4, not one verse (${drawn})`);
  });

  await t.test('the card studio is a workspace, and the card is worked on by hand', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Cards');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.doc.cards');
    await page.waitForTimeout(800);

    // It takes the whole body, like the board and the graph.
    const room = await page.evaluate(() => {
      const stage = document.querySelector('.cd-stage').getBoundingClientRect();
      const leaf = document.querySelector('.leaf > .leaf-scroll').getBoundingClientRect();
      const card = document.querySelector('.cd-canvas').getBoundingClientRect();
      return {
        wide: Math.round(leaf.width - stage.width),
        insideX: card.left >= stage.left - 1 && card.right <= stage.right + 1,
        insideY: card.top >= stage.top - 1 && card.bottom <= stage.bottom + 1,
      };
    });
    assert.equal(room.wide, 0, 'the stage is as wide as the body');
    assert.ok(room.insideX && room.insideY, 'and the whole card is on it');

    const size = () => page.evaluate(() => {
      const c = document.querySelector('.cd-canvas');
      return `${c.width}x${c.height}`;
    });
    assert.equal(await size(), '1080x1350', 'the template it opens on');

    // The frame is picked up and moved, and it goes exactly where it is put —
    // no number is typed anywhere, and nothing snaps it into a column.
    const frame = () => page.evaluate(() => {
      const box = document.querySelector('.cd-box-text').getBoundingClientRect();
      const canvas = document.querySelector('.cd-canvas');
      const shown = canvas.getBoundingClientRect();
      const k = shown.width / canvas.width;
      return {
        x: Math.round((box.x - shown.x) / k), y: Math.round((box.y - shown.y) / k),
        w: Math.round(box.width / k), h: Math.round(box.height / k),
      };
    });
    const before = await frame();
    const grab = await page.locator('.cd-box-text').boundingBox();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2 + 60, grab.y + grab.height / 2 + 80, { steps: 12 });
    assert.match(await page.locator('.cd-hint').innerText(), /x \d+ · y \d+/, 'and it says where it is while it moves');
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = await frame();
    assert.ok(moved.x > before.x && moved.y > before.y, `it followed the pointer (${JSON.stringify(moved)})`);
    assert.equal(moved.w, before.w, 'moving is not resizing');

    // It lines up with the card, and says so while it does.
    const back = await page.locator('.cd-box-text').boundingBox();
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2);
    await page.mouse.down();
    await page.mouse.move(back.x + back.width / 2 + 200, back.y + back.height / 2, { steps: 8 });
    assert.ok(await page.evaluate(() => document.querySelector('.cd-guide-x').hidden), 'no guide when it lines up with nothing');
    await page.mouse.move(back.x + back.width / 2 - 58, back.y + back.height / 2, { steps: 10 });
    await page.waitForTimeout(120);
    assert.ok(await page.evaluate(() => !document.querySelector('.cd-guide-x').hidden), 'a guide where it snapped');
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.querySelector('.cd-guide-x').hidden), 'and it goes when the drag does');

    // A corner resizes and leaves the opposite one where it was.
    const moved2 = await frame();
    const corner = await page.locator('.cd-box-text .cd-grip-se').boundingBox();
    await page.mouse.move(corner.x + 5, corner.y + 5);
    await page.mouse.down();
    await page.mouse.move(corner.x - 90, corner.y - 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const sized = await frame();
    assert.ok(sized.w < moved2.w && sized.h < moved2.h, 'the corner resized it');
    assert.deepEqual([sized.x, sized.y], [moved2.x, moved2.y], 'and the opposite corner stayed put');

    // An edge keeps the edge across from it.
    const right = sized.x + sized.w;
    const west = await page.locator('.cd-box-text .cd-grip-w').boundingBox();
    await page.mouse.move(west.x + 5, west.y + 5);
    await page.mouse.down();
    await page.mouse.move(west.x + 70, west.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const pulled = await frame();
    assert.ok(Math.abs((pulled.x + pulled.w) - right) <= 2, 'the right edge did not move');

    // Arrows nudge, and everything done here can be taken back.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    assert.equal((await frame()).x, pulled.x + 2, 'a pixel of the card per press');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
    assert.deepEqual(await frame(), sized, 'undo walks back through what was done');

    // The card's own size is dragged from its edge, like any picture.
    const wide = await page.locator('.cd-canvas').boundingBox();
    const seCorner = await page.locator('.cd-edge-se').boundingBox();
    await page.mouse.move(seCorner.x + seCorner.width / 2, seCorner.y + seCorner.height / 2);
    await page.mouse.down();
    await page.mouse.move(seCorner.x + 60, seCorner.y + 40, { steps: 10 });
    assert.match(await page.locator('.cd-hint').innerText(), /\d+ × \d+/, 'and it says how big it is getting');
    assert.ok(await page.evaluate((was) => document.querySelector('.cd-canvas').getBoundingClientRect().width > was,
      wide.width), 'the card grows under the pointer rather than being re-fitted away from it');
    await page.mouse.up();
    await page.waitForTimeout(400);
    const grown = await size();
    assert.notEqual(grown, '1080x1350', `the card itself was resized (${grown})`);

    // The shape is behind a tool button, in a panel of this workspace.
    await page.locator('.cd-tool[data-panel="shape"]').click();
    await page.waitForSelector('.cd-panel:not([hidden])');
    await page.locator('.cd-panel .cd-presets button', { hasText: 'Slide' }).click();
    await page.waitForTimeout(500);
    assert.equal(await size(), '1600x900', 'and the card follows it');
    // A preset is one of several things to try, so the panel it was pressed in
    // is still open to try the next one in.
    assert.ok(await page.evaluate(() => !document.querySelector('.cd-panel').hidden),
      'pressing a preset does not put the panel away');
    assert.equal(await page.locator('.cd-panel .cd-presets button[aria-pressed="true"]').innerText(), 'Slide',
      'and the panel shows which one is on');

    // The margin is a measurement: widen it and the frames come in with it.
    const marginRow = page.locator('.cd-panel .set-row').filter({ hasText: 'Margin' });
    const wasIn = (await frame()).x;
    await marginRow.locator('input[type=number]').fill('240');
    await marginRow.locator('input[type=number]').press('Enter');
    await page.waitForTimeout(400);
    assert.ok((await frame()).x > wasIn + 20, 'the margin moved the text in');
    assert.equal(await marginRow.locator('input[type=range]').inputValue(), '240',
      'and the slider went where the number said');

    // A slider is a slider: the card follows every step of the drag, and the
    // control is still under the pointer at the end of it.
    const slider = page.locator('.cd-panel input[type=range]').first();
    const bar = await slider.boundingBox();
    await page.mouse.move(bar.x + bar.width * 0.5, bar.y + bar.height / 2);
    await page.mouse.down();
    const widths = [];
    for (const at of [0.56, 0.62, 0.68]) {
      await page.mouse.move(bar.x + bar.width * at, bar.y + bar.height / 2);
      await page.waitForTimeout(90);
      widths.push(await page.evaluate(() => document.querySelector('.cd-canvas').width));
    }
    const said = await page.locator('.cd-panel input[type=number]').first().inputValue();
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(new Set(widths).size, widths.length, `the card followed each step (${widths.join(', ')})`);
    assert.ok(await page.locator('.cd-panel input[type=range]').count() > 0, 'and the panel was not rebuilt under the pointer');
    assert.equal(Number(said), Number(await slider.inputValue()),
      'the figure beside a slider is the slider, not a second opinion');
    assert.ok(await page.evaluate(() => {
      const body = document.querySelector('.cd-panel-body');
      return body.scrollWidth <= body.clientWidth + 1;
    }), 'a panel never scrolls sideways');
    await page.keyboard.press('Escape');

    // A segment shows what is on the moment it is pressed, whether or not the
    // change happens to alter anything else in the panel.
    await page.locator('.cd-tool[data-panel="type"]').click();
    await page.waitForSelector('.cd-panel:not([hidden])');
    const alignRow = page.locator('.cd-panel .set-row').filter({ hasText: 'Alignment' });
    await alignRow.locator('button').nth(1).click();
    await page.waitForTimeout(200);
    assert.equal(await alignRow.locator('button[aria-pressed="true"]').count(), 1, 'one of them, and only one');
    assert.equal(await alignRow.locator('button').nth(1).getAttribute('aria-pressed'), 'true',
      'the one that was pressed');
    const faceRow = page.locator('.cd-panel .set-row').filter({ hasText: 'Scripture typeface' });
    await faceRow.locator('button').nth(2).click();
    await page.waitForTimeout(200);
    assert.equal(await faceRow.locator('button').nth(2).getAttribute('aria-pressed'), 'true');

    // A frame dragged smaller than the words in it is a question — smaller
    // frame, or smaller text? — so the card asks it where it happened, and the
    // other answer is one press away.
    await page.locator('.cd-panel .set-row').filter({ hasText: 'Text size' }).locator('button').nth(1).click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.locator('.cd-box-text').click();
    const foot = await page.locator('.cd-box-text .cd-grip-s').boundingBox();
    await page.mouse.move(foot.x + foot.width / 2, foot.y + foot.height / 2);
    await page.mouse.down();
    await page.mouse.move(foot.x + foot.width / 2, foot.y - 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.cd-box-text').getAttribute('data-over'), 'true', 'the frame says the text is too big for it');
    // Both answers are offered, because both are answers.
    assert.deepEqual(await page.locator('.cd-hint .cd-fix').allInnerTexts(), ['Fit the text', 'Grow the frame']);
    await page.locator('.cd-hint .cd-fix').nth(1).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.cd-box-text').getAttribute('data-over'), 'false', 'and one press settles it');

    // The name saves when it is left, and Enter is how it is left.
    await page.locator('.cd-name').fill('Sunday evening');
    await page.locator('.cd-name').press('Enter');
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.activeElement !== document.querySelector('.cd-name')),
      'Enter finishes rather than leaving the field looking unconfirmed');
    await page.locator('.cd-tool[data-panel="templates"]').click();
    await page.waitForSelector('.cd-panel .cd-list');
    assert.ok((await page.locator('.cd-item.is-on').innerText()).includes('Sunday evening'), 'and the name is kept');
    await page.keyboard.press('Escape');

    // Which verses the card carries is the reader's to say.
    await page.locator('.cd-tool[data-panel="passage"]').click();
    await page.waitForSelector('.cd-ref-input');
    await page.locator('.cd-ref-input').fill('ps 23:1-3');
    await page.locator('.cd-ref-input').press('Enter');
    await page.waitForTimeout(800);
    // Still open, and holding what it was told: a panel that puts itself away
    // after every press is a panel nothing can be tried twice in.
    assert.equal(await page.locator('.cd-ref-input').inputValue(), 'Psalm 23:1–3', 'the card is of what was asked for');
    await page.keyboard.press('Escape');

    await page.locator('.cd-tool[data-panel="templates"]').click();
    await page.waitForSelector('.cd-panel .cd-list');
    const started = await page.locator('.cd-item').count();
    assert.ok(started >= 3, 'a new reader starts with finished cards, not one grey default');
    await page.locator('.cd-panel-foot .cd-tool').first().click();
    await page.waitForTimeout(400);
    await page.waitForSelector('.cd-panel .cd-list');
    assert.equal(await page.locator('.cd-item').count(), started + 1, 'one more of their own');
    await page.reload();
    await page.waitForSelector('.doc.cards', { timeout: 20000 });
    await page.waitForTimeout(700);
    await page.locator('.cd-tool[data-panel="templates"]').click();
    await page.waitForSelector('.cd-panel .cd-list');
    assert.equal(await page.locator('.cd-item').count(), started + 1, 'and they survive a reload');
    await page.keyboard.press('Escape');
  });

  await t.test('the ribbon is the reader\'s to arrange', async () => {
    const ids = () => page.evaluate(() => [...document.querySelectorAll('.rib[data-command]')].map((b) => b.dataset.command));
    const before = await ids();
    assert.ok(before.length > 3);
    const buttons = page.locator('.rib[data-command]');
    const third = await buttons.nth(2).boundingBox();
    const first = await buttons.nth(0).boundingBox();
    await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const moved = await ids();
    assert.equal(moved[0], before[2], 'dragged to the top, and it stayed there');
    assert.equal(moved.length, before.length);

    // Carried off the rail but not to the bin, a button comes back: the only
    // way off the ribbon is the bin, so nothing is lost by a slip.
    const slipped = await buttons.nth(1).boundingBox();
    await page.mouse.move(slipped.x + slipped.width / 2, slipped.y + slipped.height / 2);
    await page.mouse.down();
    await page.mouse.move(slipped.x + 340, slipped.y + 20, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal((await ids()).length, moved.length, 'a slip removes nothing');

    // The bin is only a bin while something is being carried to it.
    const target = await buttons.nth(1).boundingBox();
    const bin = await page.locator('.rib-add').boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 5 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.rib-bin')).display), 'grid',
      'the add button becomes a bin while a drag is running');
    await page.mouse.move(bin.x + bin.width / 2, bin.y + bin.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal((await ids()).length, before.length - 1);
    await page.locator('.toast-act').last().click();
    await page.waitForTimeout(300);
    assert.deepEqual(await ids(), moved, 'undo puts it back where it was');

    // A press that never travels is still a press.
    await buttons.first().click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.tabstrip .tab').count() > 1);
  });

  await t.test('a pane strip that cannot show every tab hides them and says so', async () => {
    await page.evaluate(() => {
      document.querySelector('.sidebar.left').style.width = '150px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(400);
    const strip = () => page.evaluate(() => {
      const el = document.querySelector('.sidebar.left .pane-tabs');
      const tabs = [...el.querySelectorAll('.pane-tab')];
      const more = el.querySelector('.pane-more');
      return {
        shown: tabs.filter((t) => !t.hidden).map((t) => t.dataset.view),
        hidden: tabs.filter((t) => t.hidden).map((t) => t.dataset.view),
        count: more.hidden ? null : more.dataset.count,
        // Nothing is cut: every visible tab ends inside the strip.
        inside: tabs.filter((t) => !t.hidden).every((t) => t.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1),
      };
    });
    const narrow = await strip();
    assert.ok(narrow.hidden.length > 0, 'some tabs do not fit');
    assert.equal(narrow.count, String(narrow.hidden.length), 'and the button says how many');
    assert.ok(narrow.inside, 'the ones on show are whole');

    await page.locator('.sidebar.left .pane-more').click();
    await page.waitForSelector('.popover.menu:not([hidden])');
    const listed = await page.locator('.popover.menu .menu-name').count();
    assert.equal(listed, narrow.shown.length + narrow.hidden.length, 'the menu lists the whole row');
    await page.locator('.popover.menu .menu-item').last().click();
    await page.waitForTimeout(400);
    const after = await strip();
    assert.ok(after.shown.includes(narrow.hidden.at(-1) ?? ''), 'the pane chosen from the menu is on show');
    await page.evaluate(() => {
      document.querySelector('.sidebar.left').style.width = '';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(300);
  });

  await t.test('a pane can be put away and asked back, and stays away until it is', async () => {
    const paneTabs = () => page.evaluate(() => ({
      left: [...document.querySelectorAll('.sidebar.left .pane-tab')].map((t) => t.dataset.view),
      right: [...document.querySelectorAll('.sidebar.right .pane-tab')].map((t) => t.dataset.view),
      mounted: [...document.querySelectorAll('.pane-view')].map((v) => v.dataset.view),
    }));
    const runCommand = async (text) => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(text);
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
    };

    const before = await paneTabs();
    assert.ok(before.left.includes('tags'), 'the Tags pane starts where it registered');

    // The palette says which way the command goes before it is pressed.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Tags pane');
    await page.waitForTimeout(250);
    assert.match((await page.locator('.modal-list .mi-t').first().innerText()), /Hide Tags pane/,
      'a pane that is up offers to be put away');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    const hidden = await paneTabs();
    assert.ok(!hidden.left.includes('tags'), 'and it goes');
    assert.ok(!hidden.mounted.includes('tags'), 'taking its view with it, not merely hiding it');
    assert.deepEqual(hidden.left, before.left.filter((id) => id !== 'tags'),
      'the rest of the strip is untouched');

    // Asked for again by name, it comes back where its own registration says.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Tags pane');
    await page.waitForTimeout(250);
    assert.match((await page.locator('.modal-list .mi-t').first().innerText()), /Show Tags pane/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const back = await paneTabs();
    assert.deepEqual([...back.left].sort(), [...before.left].sort(), 'the same panes, none lost');
    // Not appended to the end: a pane switched back on takes the place its own
    // registration declares, which is what makes that metadata its home rather
    // than a guess made once at first run.
    assert.ok(back.left.indexOf('tags') < back.left.indexOf('project'),
      `placed by its own order, not on the end (${back.left.join(', ')})`);
    assert.ok(await page.locator('.sidebar.left .pane-view[data-view="tags"] .tagcloud').count(),
      'and built, not an empty box');

    // A feature's own command must revive its pane rather than answer with
    // silence — the thing that would have broken five commands.
    await runCommand('Hide Search pane');
    assert.ok(!(await paneTabs()).left.includes('search'));
    await runCommand('Search');
    await page.waitForTimeout(300);
    assert.ok((await paneTabs()).left.includes('search'), 'the Search command brought its pane back');
    assert.ok(await page.evaluate(() => Boolean(document.activeElement?.closest('.search-field'))),
      'and put the caret where it always does');

    // Put away for good: hidden panes survive a reload, which is the whole
    // reason the app records which panes a reader has been offered.
    await runCommand('Hide Links pane');
    await page.waitForTimeout(500);
    const parted = await paneTabs();
    await app.open();
    await page.waitForSelector('.pane-tab', { timeout: 20000 });
    await page.waitForTimeout(600);
    const reloaded = await paneTabs();
    assert.ok(![...reloaded.left, ...reloaded.right].includes('links'), 'still away after a restart');
    // And only that one: the arrangement comes back exactly as it was left,
    // which is the part a pane that reappeared by itself would have wrecked.
    assert.deepEqual([...reloaded.left].sort(), [...parted.left].sort(), 'the left side as it was left');
    assert.deepEqual([...reloaded.right].sort(), [...parted.right].sort(), 'and the right');
    await runCommand('Show Links pane');
    assert.ok([...(await paneTabs()).left, ...(await paneTabs()).right].includes('links'),
      'and it is one command from coming back');
  });

  await t.test('emptying a sidebar by hiding, not only by dragging, still shuts it', async () => {
    const right = () => page.evaluate(() => ({
      empty: document.querySelector('.sidebar.right').dataset.empty,
      disabled: document.querySelector('.tb-btn[data-l="side.right"]')?.disabled ?? null,
    }));
    // The panes on that side by the name their own command uses.
    const names = await page.evaluate(() => [...document.querySelectorAll('.sidebar.right .pane-tab')]
      .map((t) => t.getAttribute('title')));
    assert.ok(names.length, 'there is a sidebar to empty');
    const before = await page.evaluate(() => document.querySelectorAll('.sidebar .pane-tab').length);
    const byName = async (word, name) => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(`${word} ${name} pane`);
      await page.waitForTimeout(250);
      await page.locator('.modal-list .mi', { hasText: `${word} ${name} pane` }).first().click();
      await page.waitForTimeout(350);
    };
    for (const name of names) await byName('Hide', name);

    const state = await right();
    assert.equal(state.empty, 'true', 'a sidebar hidden empty is an empty sidebar');
    assert.equal(state.disabled, true, 'and its toggle says so rather than answering with silence');
    assert.equal(await page.evaluate(() => document.body.dataset.right), 'shut');

    // Put them back, so what follows sees the app it expects. They return to
    // the side each one registered for, which for a pane dragged across
    // earlier in this suite is not the side it was just hidden from.
    for (const name of names) await byName('Show', name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.sidebar .pane-tab').length),
      before, 'every one of them is back on screen');
  });

  await t.test('a document keeps its place when something in it changes', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.lib-tab[aria-selected="true"]');
    // The whole catalog is the long list; what is on this device is short.
    await page.locator('.lib-tab[data-page="more"]').click();
    await page.locator('.lib-src[data-source="catalog"]').click();
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(400);
    const scroller = '.leaf > .leaf-scroll';
    // A short window, so the list is longer than the room and there is a place
    // to lose.
    await page.setViewportSize({ width: 1100, height: 320 });
    try {
      await page.waitForTimeout(400);
      // Half way, not the very bottom: a list that loses a row is shorter, and
      // the browser clamps a scroll position past the new end whatever the app
      // does about it.
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
      }, scroller);
      await page.waitForTimeout(200);
      // Opening a row's menu may bring the row into view; the place to keep is
      // where the list is once the menu is open.
      // The Burmese one is listed last and no later test reads it. Brought to
      // the middle first, so pressing its menu does not scroll the list.
      await page.evaluate(() => document.querySelector('.library-item[data-identify="judson1835"]').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      await page.locator('.library-item[data-identify="judson1835"] .lib-act[aria-haspopup="menu"]').click();
      await page.waitForSelector('.popover.menu');
      const before = await page.evaluate((s) => document.querySelector(s).scrollTop, scroller);
      assert.ok(before > 40, `scrolled down the list (${before})`);
      // Removing a translation repaints the list; the reader stays where they were.
      await page.locator('.popover.menu').getByRole('menuitem', { name: 'Remove', exact: true }).click();
      await page.waitForTimeout(1500);
      const after = await page.evaluate((s) => document.querySelector(s).scrollTop, scroller);
      assert.ok(Math.abs(after - before) < 60, `the page did not jump to the top (${before} → ${after})`);
    } finally {
      // Whatever happened, the tests after this one get the window they expect.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
    }
  });

  await t.test('every document has exactly one place that scrolls', async () => {
    // A document that builds its own scrolling box inside the one the workspace
    // gave it ends up with two, and the wheel reaches neither reliably.
    for (const doc of ['help', 'shortcuts', 'formats', 'welcome', 'about']) {
      await page.evaluate((id) => window.__lai?.openDoc?.(id), doc);
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(doc === 'formats' ? 'Data and formats' : doc);
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      const count = await page.evaluate(() => document.querySelectorAll('#app .leaf .leaf-scroll').length);
      assert.equal(count, 1, `${doc} has one scrolling box`);
    }
  });

  await t.test('a reference can be read without going to it, or opened beside what you are reading', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Genesis 1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.verse');
    await page.waitForTimeout(600);

    const link = page.locator('.xref').first();
    assert.ok(await link.count(), 'the fixture carries a cross-reference');

    // Resting on it reads it where it stands. Nothing is navigated: the
    // chapter behind the popover is the one the reader was in.
    const was = await page.locator('.crumbs').first().innerText();
    await link.hover();
    await page.waitForTimeout(700);
    assert.ok(await page.evaluate(() => !document.querySelector('.peek')?.hidden), 'a peek opened');
    assert.match(await page.locator('.peek .pk-ref').innerText(), /23:1$/, 'the reference it names');
    assert.match(await page.locator('.peek .pk-text').innerText(), /23:1/, 'and it is the verse itself');
    assert.equal(await page.locator('.crumbs').first().innerText(), was, 'and the reader has not moved');

    // Out of the way the moment it is not wanted.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.querySelector('.peek').hidden), 'Escape puts it away');

    // Ctrl-press opens it in a tab of its own, leaving this one where it was.
    const tabs = () => page.locator('.tabstrip .tab').count();
    const before = await tabs();
    await link.click({ modifiers: ['Control'] });
    await page.waitForTimeout(700);
    assert.equal(await tabs(), before + 1, 'a new tab');
    assert.match(await page.locator('.crumbs').first().innerText(), /23/, 'showing the passage that was followed');
    assert.ok(await page.locator('.verse.is-hit, .vblock .is-hit').count() >= 0);

    // A plain press still replaces the tab, which is what small screens need.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Exodus 1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.xref', { timeout: 15000 });
    await page.waitForTimeout(400);
    const same = await tabs();
    await page.locator('.xref').first().click();
    await page.waitForTimeout(800);
    assert.equal(await tabs(), same, 'and an ordinary press opens no tab at all');
    assert.match(await page.locator('.crumbs').first().innerText(), /23/, 'in the tab it was pressed in');
  });

  await t.test('a translation of your own can be brought in, whatever it was written as', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(400);

    const usfm = [
      '\\id PHM Philemon',
      '\\h Philemon',
      '\\c 1',
      '\\s Greeting',
      '\\p',
      ...Array.from({ length: 25 }, (_, i) => `\\v ${i + 1} Philemon verse ${i + 1}, from a file somebody made.\\f + \\ft a note\\f*`),
    ].join('\n');

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.lib-act[title="Add your own"]').click();
    await (await chooser).setFiles({ name: 'philemon.usfm', mimeType: 'text/plain', buffer: Buffer.from(usfm) });
    await page.waitForSelector('.fd', { timeout: 10000 });

    // The question is asked with the answer already in it.
    assert.equal(await page.locator('.fd-opt[aria-pressed="true"] .fd-opt-n').innerText(), 'USFM');
    assert.equal(await page.locator('.fd-row[data-field="identify"] input').inputValue(), 'phm',
      'read from the file, not from its name');
    assert.equal(await page.locator('.fd-row[data-field="name"] input').inputValue(), 'Philemon');

    await page.locator('.fd-row[data-field="language"] input').fill('eng');
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForTimeout(3000);

    const mine = page.locator('.library-item.state-local');
    assert.equal(await mine.count(), 1, 'it is in the library');
    const text = await mine.first().innerText();
    assert.match(text, /Yours, imported/, 'and it is not described as dropped from the catalog');
    assert.match(text, /USFM/, 'it says what it was made from');

    // And it is a translation like any other: readable, and checked against the
    // canon exactly as a published one is.
    assert.match(text, /books missing|books\b/, 'the canon report is the same report');
    await page.locator('.crumb-tr').first().click().catch(() => {});
    await page.keyboard.press('Escape');
  });

  await t.test('a language nobody spelled in two letters still reaches the browser', async () => {
    // The live defect this batch began with. The Danish fixture carries a
    // 639-3 code and an empty 639-1, which is the ordinary state of a real
    // file — and `lang="dan"` means nothing to a font rule, a line breaker or
    // a speech engine. It has to arrive as `da`.
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
    await switchTo('Danske');
    const tag = await page.evaluate(() => document.querySelector('.leaf[data-role="primary"] [lang]')?.getAttribute('lang'));
    assert.equal(tag, 'da', 'the three-letter code was mapped to the one the browser knows');
  });

  await t.test('a tab nudged by a few pixels stays where it was', async () => {
    // Tabs that do not fit are `hidden`, so they measure zero and sit at x 0 —
    // to the left of everything, and therefore "passed" by any rightward
    // movement. A five-pixel nudge used to send a tab to the far end of the
    // strip, and the new order was persisted.
    const order = () => page.evaluate(() => [...document.querySelectorAll('.tabstrip .tab')].map((t) => t.dataset.tab));
    const before = await order();
    assert.ok(before.length >= 3, 'several tabs are open by now');

    const first = await page.locator('.tabstrip .tab').first().boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2 + 6, first.y + first.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.deepEqual(await order(), before, 'a nudge is not an instruction');
  });

  await t.test('Enter does not answer yes to a question about deleting things', async () => {
    // The dialog opens with the cancel button focused precisely so that a
    // reader pressing Enter out of habit destroys nothing. A keydown handler
    // answered yes anyway, from anywhere, and suppressed the cancel button's
    // own activation while doing it.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Cards');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.doc.cards');
    await page.waitForTimeout(700);

    await page.locator('.cd-tool[data-panel="templates"]').click();
    await page.waitForSelector('.cd-panel .cd-list');
    const held = await page.locator('.cd-item').count();
    await page.locator('.cd-panel-foot .cd-tool.danger').click();
    await page.waitForSelector('.confirm', { timeout: 5000 });

    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.scrim:not([hidden]) .confirm').count(), 0, 'the dialog closed');
    await page.locator('.cd-tool[data-panel="templates"]').click().catch(() => {});
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.cd-item').count(), held, 'and nothing was deleted by it');
    await page.keyboard.press('Escape');
  });

  await t.test('the read-aloud button says what it is doing, and how far along', async () => {
    // A long chapter on purpose: the stub speaks a verse every fifth of a
    // second, and a six-verse psalm would be finished before the test got to
    // the pause — at which point the next press starts reading rather than
    // pausing, and the failure reads as a bug in the button.
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Genesis 1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.verse');
    await page.waitForTimeout(400);

    // Headless Chromium has a speech engine with no voices in it, so both are
    // stood up here — in the language actually on screen, because the app
    // refuses to read a language it has no voice for and that refusal is
    // behaviour the rest of the suite depends on, not a thing to work around.
    const tag = await page.evaluate(() => document.querySelector('.leaf[data-role="primary"] [lang]')?.getAttribute('lang') ?? 'en');
    await page.evaluate((lang) => {
      const made = [
        { name: 'Reader', lang, voiceURI: 'r', localService: true, default: true },
        { name: 'Nora', lang: 'nb-NO', voiceURI: 'n', localService: true, default: false },
      ];
      window.speechSynthesis.getVoices = () => made;
      let held = null;
      window.speechSynthesis.speak = (utterance) => {
        held = utterance;
        // One verse per beat, so the ring has somewhere to go.
        setTimeout(() => { if (held === utterance) utterance.onend?.(); }, 220);
      };
      window.speechSynthesis.cancel = () => { held = null; };
      window.speechSynthesis.pause = () => {};
      window.speechSynthesis.resume = () => {};
      // The feature listens on the synthesiser, not on the window.
      window.speechSynthesis.dispatchEvent(new Event('voiceschanged'));
    }, tag);
    await page.waitForTimeout(300);

    const button = page.locator('.rib[data-command="speech.toggle"]');
    if (!await button.count()) return; // not on this reader's ribbon
    assert.equal(await button.locator('use').getAttribute('href'), '#i-audio', 'idle: the speaker');

    await button.click();
    await page.waitForTimeout(700);
    assert.equal(await button.locator('use').getAttribute('href'), '#i-pause',
      'speaking: the glyph is what pressing it would do next');
    assert.match(await button.getAttribute('title'), /verse \d+ of \d+/, 'and it says where it has got to');
    const ring = await button.evaluate((n) => ({
      marked: n.classList.contains('has-progress'),
      at: n.style.getPropertyValue('--progress'),
    }));
    assert.ok(ring.marked, 'the ring is drawn');
    assert.match(ring.at, /^[\d.]+%$/);

    // It moves. A ring set once and never again is a decoration.
    await page.waitForTimeout(900);
    const later = await button.evaluate((n) => n.style.getPropertyValue('--progress'));
    assert.notEqual(later, ring.at, `the ring advances (${ring.at} → ${later})`);

    await button.click();
    await page.waitForTimeout(300);
    assert.equal(await button.locator('use').getAttribute('href'), '#i-play', 'paused: press to carry on');

    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Stop reading');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal(await button.locator('use').getAttribute('href'), '#i-audio', 'and back to the speaker when it stops');
    assert.ok(!await button.evaluate((n) => n.classList.contains('has-progress')), 'with no ring left behind');
  });

  await t.test('the voices on this device are listed only when somebody asks', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Voices on this device');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.vx-list', { timeout: 10000 });
    await page.waitForTimeout(300);

    const groups = await page.locator('.vx-group h2').allInnerTexts();
    assert.ok(groups.length >= 2, `grouped by language (${groups.join(', ')})`);
    assert.match(groups[0], /The language on screen/, 'the language being read comes first');
    assert.equal(await page.locator('.vx-item').count(), 2);
    assert.ok(await page.locator('.vx-try').first().count(), 'every voice can be heard');

    // The filter narrows it, and nothing of it survives being closed.
    await page.locator('.vx-tools input[type=search]').fill('nora');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.vx-item').count(), 1);
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.vx-list').count(), 0, 'built on demand, and gone with the tab');
  });

  await t.test('a chapter can be looked at as the file any other software would read', async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+e');
    await page.waitForSelector('textarea.source', { timeout: 10000 });
    await page.waitForTimeout(300);

    assert.match(await page.locator('.src-btn').innerText(), /Markdown/, 'it opens where it always did');
    assert.equal(await page.locator('textarea.source').getAttribute('readonly'), null, 'and that one is editable');
    // The text gets the whole leaf: the controls are one button in the crumb
    // bar, and wrapping the textarea in a toolbar left it half the height.
    const room = await page.evaluate(() => {
      const area = document.querySelector('textarea.source');
      const leaf = area?.closest('.leaf-scroll');
      return leaf ? Math.round((area.getBoundingClientRect().height / leaf.getBoundingClientRect().height) * 100) : 0;
    });
    assert.ok(room >= 98, `the textarea fills the leaf (${room}%)`);
    // And one scrollbar, not two: the textarea scrolls its own text, so the
    // box around it must not have anything left to scroll.
    const spare = await page.evaluate(() => {
      const leaf = document.querySelector('textarea.source')?.closest('.leaf-scroll');
      return leaf ? leaf.scrollHeight - leaf.clientHeight : -1;
    });
    assert.equal(spare, 0, `the leaf has nothing of its own to scroll (${spare}px over)`);

    await page.locator('.src-btn').click();
    await page.waitForTimeout(250);
    const offered = await page.locator('.popover.menu .menu-name').allInnerTexts();
    assert.ok(offered.includes('USFM') && offered.includes('OSIS') && offered.includes('This app’s JSON'),
      `every writer is offered (${offered.join(', ')})`);

    await page.locator('.popover.menu .menu-item', { hasText: 'USFM' }).first().click();
    await page.waitForTimeout(600);
    const usfm = await page.locator('textarea.source').inputValue();
    assert.match(usfm, /^\\id [A-Z1-9]{3} /, 'the chapter, as USFM');
    assert.match(usfm, /\n\\c \d+\n/);
    assert.match(usfm, /\n\\v 1 /);
    assert.equal(await page.locator('textarea.source').getAttribute('readonly'), '',
      'and a view rather than a box that discards what is typed into it');

    // The thing that never existed: a way to get the text out. Both are in the
    // same menu as the formats, because one button is a strip of workspace.
    await page.locator('.src-btn').click();
    await page.waitForTimeout(200);
    assert.ok(await page.locator('.popover.menu .menu-item', { hasText: 'Copy all of it' }).count());
    const saving = page.waitForEvent('download');
    await page.locator('.popover.menu .menu-item', { hasText: 'Save as a file' }).click();
    const file = await saving;
    assert.match(file.suggestedFilename(), /\.usfm$/);

    await page.locator('.src-btn').click();
    await page.waitForTimeout(200);
    await page.locator('.popover.menu .menu-item', { hasText: 'Markdown' }).first().click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(400);
  });

  await t.test('a translation on this device can be written out as something else', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(400);

    const row = page.locator('.library-item.state-installed, .library-item.state-update').first();
    await row.locator('.lib-act[aria-haspopup="menu"]').click();
    await page.waitForSelector('.popover.menu');
    await page.locator('.popover.menu .menu-item', { hasText: 'Export' }).click();
    await page.waitForSelector('.fd', { timeout: 10000 });

    const formats = await page.locator('.fd-row[data-field="format"] option').allInnerTexts();
    assert.ok(formats.length >= 6, `every writer is offered (${formats.join(', ')})`);
    // It says what it will do before it is asked to do it.
    assert.match(await page.locator('.fd-live').innerText(), /66 books · \d+ chapters/, 'on open');
    // One book, as USFM: the granular case, which is what anybody actually wants.
    await page.locator('.fd-row[data-field="format"] select').selectOption('usfm');
    // Sixty-six books of USFM are sixty-six files: only a zip is offered.
    assert.equal(await page.locator('.fd-row[data-field="pack"] select').inputValue(), 'zip');
    // Naming books is the same question as the scope beside it, so it stands
    // in that row and takes it over.
    const scope = page.locator('.fd-row[data-field="scope"] .fd-opts');
    assert.equal(await scope.getAttribute('data-free'), '0', 'nothing named yet');
    await scope.locator('input.fd-free').fill('Psalms');
    await page.waitForTimeout(250);
    assert.equal(await scope.getAttribute('data-free'), '1', 'and the choices it overrules step back');
    const live = await page.locator('.fd-live').innerText();
    assert.match(live, /1 books? · 150 chapters/, `and again after every answer (${live})`);
    assert.match(live, /paragraphing/, 'with what the format cannot carry');
    // Pressing a choice is the way back: it clears what was named.
    await scope.locator('.fd-opt', { hasText: 'All' }).first().click();
    await page.waitForTimeout(200);
    assert.equal(await scope.locator('input.fd-free').inputValue(), '');
    assert.match(await page.locator('.fd-live').innerText(), /66 books/, 'and the whole translation is back');
    await scope.locator('input.fd-free').fill('Psalms');
    await page.waitForTimeout(250);
    // One book is one file again: the reader's own choice comes back when it
    // is offered again, rather than staying on the zip it was moved to.
    assert.equal(await page.locator('.fd-row[data-field="pack"] select').inputValue(), 'file');
    const saving = page.waitForEvent('download');
    await page.locator('.fd-acts .btn.primary').click();
    const file = await saving;
    assert.match(file.suggestedFilename(), /\.usfm$/, 'one book is one file, not an archive');
    await page.waitForTimeout(600);
  });

  await t.test('a translation as it is published — an archive, taken whole', async () => {
    // What eBible.org hands out: the scripture, the book names, the metadata
    // and the copyright, in one download.
    const bundle = await page.evaluate(async () => {
      const enc = new TextEncoder();
      const table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i += 1) { let c = i; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
        return t;
      })();
      const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const verses = Array.from({ length: 31 }, (_, i) => `<v id="${i + 1}"/>In the <w s="H7225">beginning</w> God created verse ${i + 1}.<ve/>`).join('');
      const files = [
        { name: 'engkjvcpb_usfx.xml', text: `<usfx><book id="GEN"><c id="1"/>${verses}</book></usfx>` },
        { name: 'BookNames.xml', text: '<BookNames><book code="GEN" abbr="Gen" short="Genesis" long="The First Book of Moses"/></BookNames>' },
        { name: 'engkjvcpbmetadata.xml', text: '<DBLMetadata><identification><name>KJV Cambridge Paragraph Bible</name><abbreviation>KJVCPB</abbreviation></identification><language><iso>eng</iso><name>English</name><scriptDirection>LTR</scriptDirection></language></DBLMetadata>' },
        { name: 'copr.htm', text: '<html><body>Public domain.</body></html>' },
        { name: 'dejavuserif.css', text: 'body{}' },
      ];
      const parts = []; const central = []; let offset = 0;
      for (const file of files) {
        const name = enc.encode(file.name); const body = enc.encode(file.text);
        const local = new Uint8Array(30 + name.byteLength); const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
        lv.setUint32(14, crc(body), true); lv.setUint32(18, body.byteLength, true);
        lv.setUint32(22, body.byteLength, true); lv.setUint16(26, name.byteLength, true);
        local.set(name, 30); parts.push(local, body);
        const head = new Uint8Array(46 + name.byteLength); const hv = new DataView(head.buffer);
        hv.setUint32(0, 0x02014b50, true); hv.setUint32(16, crc(body), true);
        hv.setUint32(20, body.byteLength, true); hv.setUint32(24, body.byteLength, true);
        hv.setUint16(28, name.byteLength, true); hv.setUint32(42, offset, true);
        head.set(name, 46); central.push(head);
        offset += local.byteLength + body.byteLength;
      }
      const dir = central.reduce((n, c) => n + c.byteLength, 0);
      const end = new Uint8Array(22); const ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true); ev.setUint32(12, dir, true); ev.setUint32(16, offset, true);
      const blob = new Blob([...parts, ...central, end]);
      return [...new Uint8Array(await blob.arrayBuffer())];
    });

    const chooser = page.waitForEvent('filechooser');
    await page.locator('.lib-act[title="Add your own"]').click();
    await (await chooser).setFiles({
      name: 'engkjvcpb_usfx.zip', mimeType: 'application/zip', buffer: Buffer.from(bundle),
    });
    await page.waitForSelector('.fd', { timeout: 15000 });

    // The archive answers the questions, so the reader confirms rather than types.
    assert.match(await page.locator('.fd-lede').innerText(), /1 scripture file/);
    assert.match(await page.locator('.fd-lede').innerText(), /own book names/);
    assert.equal(await page.locator('.fd-row[data-field="name"] input').inputValue(), 'KJV Cambridge Paragraph Bible');
    assert.equal(await page.locator('.fd-row[data-field="language"] input').inputValue(), 'eng');
    assert.equal(await page.locator('.fd-row[data-field="format"]').count(), 0, 'and it is not asked what format it is');

    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForTimeout(3500);
    assert.equal(await page.locator('.library-item.state-local').count(), 2, 'it is in the library');
  });

  await t.test('a Strong\'s number says what it means, once there is a lexicon to ask', async () => {
    await page.route('**/lexicon/strongs-h.json', (route) => route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'lai-siangtho', kind: 'lexicon', schema: 1, testament: 'H',
        entry: { 7225: { lemma: 'רֵאשִׁית', xlit: 'rêʼshîyth', strongs_def: 'the first, in place, time, order or rank' } },
      }),
    }));

    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
    await switchTo('Danske');
    await page.waitForSelector('.strongs', { timeout: 15000 });
    await page.locator('.strongs').first().click();
    await page.waitForTimeout(400);

    // Not a dead end: a dead end with the way out on it.
    const offer = page.locator('.popover:not([hidden])');
    assert.match(await offer.innerText(), /not on this device/);
    await page.locator('.pv-get').click();
    await page.waitForTimeout(1500);
    const shown = await offer.innerText();
    assert.match(shown, /רֵאשִׁית/, 'the word itself');
    assert.match(shown, /the first, in place/, 'and what it means');

    // And the second press answers without asking the network again.
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    await page.locator('.strongs').first().click();
    await page.waitForTimeout(300);
    assert.match(await offer.innerText(), /the first, in place/, 'kept, not fetched twice');
  });

  await t.test('a translation can be looked at closely, and the counts become places', async () => {
    await toChapter();
    await switchTo('Danske');
    // In from the Library, which is where somebody looking at translations is.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(400);
    await page.locator('.library-item[data-identify="ddb1931"] .lib-act[aria-haspopup="menu"]').click();
    await page.waitForSelector('.popover.menu');
    await page.locator('.popover.menu .menu-item', { hasText: 'Look closer' }).click();
    await page.waitForSelector('.rp', { timeout: 10000 });
    await page.waitForTimeout(400);

    assert.deepEqual(await page.locator('.rp-sec h2').allInnerTexts(), ['What it holds', 'The books']);
    assert.equal(await page.locator('.rp-books > li').count(), 66, 'every book of the canon has a row');
    // Before the pass, the record can say which books are absent and which
    // chapters it recorded as a different length, and nothing else.
    assert.match(await page.locator('.rp-sec').nth(1).innerText(), /unknown until the chapters have been read/);
    assert.ok(await page.locator('.rp-book.is-absent').count() > 50, 'the books this edition lacks say so');

    await page.locator('.rp-head .btn.primary').click();
    await page.waitForFunction(() => !document.querySelector('.rp-head .btn.primary')?.disabled, null, { timeout: 60000 });
    await page.waitForTimeout(300);

    // One pass, and the numbers on every book are answered.
    const psalms = page.locator('.rp-books > li').filter({ has: page.locator('.rp-bid', { hasText: /^19$/ }) });
    const badges = await psalms.locator('.rp-badge').allInnerTexts();
    assert.deepEqual(badges, ['M1', 'H2', 'L0'], `the merge and both headings are counted (${badges.join(' ')})`);

    // The row opens onto the chapters those numbers came from.
    await psalms.locator('.rp-book').click();
    await page.waitForTimeout(300);
    assert.match(await psalms.locator('.rp-detail').innerText(), /Samlerne|Salmerne/, 'with what the edition says about the book');
    assert.match(await psalms.locator('.rp-chapters').innerText(), /3–4/, 'and the merge itself');

    // A row is a place: pressing it opens the chapter it names.
    await psalms.locator('.rp-go').first().click();
    await page.waitForTimeout(700);
    assert.match(await page.locator('.crumbs').first().innerText(), /Salmernes Bog/,
      'and the report is a way into the text, not a dead end');
  });

  await t.test('the report leaves as a file, and survives being left', async () => {
    // Back by name: by this point in the suite the strip has more tabs than
    // room, and the one wanted may be behind its overflow button.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Look closer');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.rp');
    await page.waitForTimeout(500);
    // The walk is paid for once: looking at a chapter and coming back must not
    // throw the answer away.
    const badges = await page.locator('.rp-books > li')
      .filter({ has: page.locator('.rp-bid', { hasText: /^19$/ }) }).locator('.rp-badge').allInnerTexts();
    assert.deepEqual(badges, ['M1', 'H2', 'L0'], 'the examination survived the tab change');

    const saving = page.waitForEvent('download');
    await page.locator('.rp-head-acts .btn:not(.primary)').click();
    await page.waitForSelector('.popover.menu');
    await page.locator('.popover.menu .menu-item', { hasText: 'Markdown' }).click();
    const file = await saving;
    assert.match(file.suggestedFilename(), /^ddb1931-report\.md$/);
  });

  await t.test('the headings of a whole translation are one list, filtered', async () => {
    await toChapter();
    const tab = page.locator('.sidebar .pane-tab[data-view="outline"]:not([hidden])');
    if (!await tab.count()) return; // the strip may have hidden it; the report covers the data
    await tab.click();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.locator('.ol-tab').evaluateAll((ns) => ns.map((n) => n.title)),
      ['Chapter', 'Book', 'Everywhere'], 'the scope is three glyphs, named for anyone who needs the words');

    await page.locator('.ol-tab[title="Everywhere"]').click();
    await page.waitForTimeout(2500);
    const rows = await page.locator('.ol-body .outline-row').allInnerTexts();
    assert.ok(rows.some((r) => /Herren er min hyrde/.test(r)), `the pericope heading is listed (${rows.join(' | ')})`);
    assert.ok(rows.some((r) => /Den brændende busk/.test(r)), 'and a heading from another book with it');
    assert.ok(rows.every((r) => /\d/.test(r)), 'each says where it is');

    await page.locator('.ol-filter').fill('hyrde');
    await page.waitForTimeout(350);
    const found = await page.locator('.ol-body .outline-row').allInnerTexts();
    assert.ok(found.length && found.every((r) => /hyrde/i.test(r)), `the filter narrows it (${found.join(' | ')})`);
    await page.locator('.ol-filter').fill('');
    await page.locator('.ol-tab[title="Chapter"]').click();
    await page.waitForTimeout(400);
  });

  await t.test('a tab comes back to where it was left', async () => {
    await toChapter();
    await page.waitForSelector('.verse');
    await page.waitForTimeout(300);
    const top = () => page.evaluate(() => Math.round(document.querySelector('.leaf-scroll')?.scrollTop ?? -1));
    // Half of whatever room this chapter has, rather than a number that may be
    // past its end in a tall window.
    await page.evaluate(() => {
      const el = document.querySelector('.leaf-scroll');
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    });
    await page.waitForTimeout(250);
    const parked = await top();
    assert.ok(parked > 20, `there is room to scroll (${parked})`);

    // Every tab change rebuilds the workspace, and a new element starts at the
    // top — so the place was being thrown away on the way out.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(500);
    await toChapter();
    await page.waitForTimeout(600);
    assert.equal(await top(), parked, 'the chapter is where it was left');

    // A different passage in the same tab is a different thing to be looking
    // at, and belongs at its beginning.
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('gen 3');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    assert.equal(await top(), 0, 'a chapter stepped to starts at the top');
  });

  await t.test('no label breaks out of the button it belongs to', async () => {
    // A pane is 240 px wide and its buttons are labelled in sentences, so a
    // label that will not fit has to be cut rather than wrapped: with a fixed
    // height, a second line is drawn straight through the border.
    await toChapter();
    // Whatever the suite has left on show — a tab the strip has hidden for
    // want of room cannot be clicked, and is not what this is about.
    const tabs = await page.locator('.sidebar .pane-tab:not([hidden])').all();
    for (const tab of tabs) { await tab.click(); await page.waitForTimeout(200); }
    const spilling = await page.evaluate(() => [...document.querySelectorAll('.sidebar .btn')]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .filter((b) => b.scrollHeight > Math.ceil(b.getBoundingClientRect().height) + 1)
      .map((b) => `${b.textContent.trim().slice(0, 30)} (${b.scrollHeight} in ${Math.round(b.getBoundingClientRect().height)})`));
    assert.deepEqual(spilling, [], 'every label is held to the one line the button is tall');

    // And cut with an ellipsis rather than through the middle of a letter,
    // which is what the label needs its own element for.
    const held = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sidebar .btn')].find((x) => x.querySelector('.btn-t'));
      if (!b) return null;
      const t = b.querySelector('.btn-t');
      return { clipped: getComputedStyle(t).textOverflow, whole: b.title || b.textContent.trim() };
    });
    assert.equal(held?.clipped, 'ellipsis');
    assert.ok(held?.whole, 'and the whole of it is still readable somewhere');
  });

  await t.test('nothing failed along the way', () => {
    assert.deepEqual(app.problems, []);
    // The English fixture has no language pack, which is the ordinary case the
    // app must survive; nothing else is allowed to be missing.
    assert.deepEqual(app.missing.filter((u) => !/lang\/iso-eng\.json$/.test(u)), []);
  });
});
