/**
 * What a reader can actually do, driven against the built app.
 *
 * One browser for the whole file: launching one costs more than every check in
 * here put together, and the subtests are ordered so each leaves the app in a
 * state the next one can use.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('the app in a browser', options, async (t) => {
  const app = await launch();
  const { page } = app;
  t.after(() => app.close());

  const install = async (identify) => {
    const button = page.locator(`[data-identify="${identify}"] button`, { hasText: 'Make available offline' });
    if (await button.count()) await button.click();
    await page.locator(`[data-identify="${identify}"] .badge-ok`).waitFor({ timeout: 60000 });
  };
  /** Back to reading: a document tab has no crumb bar to switch translations from. */
  const toChapter = async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.crumb-tr');
  };
  const switchTo = async (name) => {
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
    await page.locator('.wl-acts .btn.primary').click();
    await page.waitForSelector('.library-item', { timeout: 20000 });
    assert.ok(await page.locator('.library-item').count() >= 3, 'the catalog is listed');
  });

  await t.test('installs a translation and reads a chapter', async () => {
    await install('kjv1611');
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
    const slider = page.locator('.rpanel .rp-row').nth(4).locator('input[type=range]');
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
    assert.ok(await page.locator('#barApp').isVisible(), 'the app pill');
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
    assert.match(text, /\d+ differences/, 'and how it differs from the canon');
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

    // The shape is behind a tool button, in a panel of this workspace.
    await page.locator('.cd-tool[data-panel="shape"]').click();
    await page.waitForSelector('.cd-panel:not([hidden])');
    await page.locator('.cd-panel .cd-presets button', { hasText: 'Slide' }).click();
    await page.waitForTimeout(500);
    assert.equal(await size(), '1600x900', 'and the card follows it');

    // A slider is a slider: the card follows every step of the drag, and the
    // control is still under the pointer at the end of it.
    await page.locator('.cd-tool[data-panel="shape"]').click();
    await page.waitForSelector('.cd-panel:not([hidden])');
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
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(new Set(widths).size, widths.length, `the card followed each step (${widths.join(', ')})`);
    assert.ok(await page.locator('.cd-panel input[type=range]').count() > 0, 'and the panel was not rebuilt under the pointer');
    assert.ok(await page.evaluate(() => {
      const body = document.querySelector('.cd-panel-body');
      return body.scrollWidth <= body.clientWidth + 1;
    }), 'a panel never scrolls sideways');
    await page.keyboard.press('Escape');

    // Which verses the card carries is the reader's to say.
    await page.locator('.cd-tool[data-panel="passage"]').click();
    await page.waitForSelector('.cd-ref-input');
    await page.locator('.cd-ref-input').fill('ps 23:1-3');
    await page.locator('.cd-ref-input').press('Enter');
    await page.waitForTimeout(800);
    await page.locator('.cd-tool[data-panel="passage"]').click();
    assert.equal(await page.locator('.cd-ref-input').inputValue(), 'Psalm 23:1–3', 'the card is of what was asked for');
    await page.keyboard.press('Escape');

    await page.locator('.cd-tool[data-panel="templates"]').click();
    await page.waitForSelector('.cd-panel .cd-list');
    const started = await page.locator('.cd-item').count();
    assert.ok(started >= 3, 'a new reader starts with finished cards, not one grey default');
    await page.locator('.cd-panel-foot .cd-tool').first().click();
    await page.waitForTimeout(400);
    await page.locator('.cd-tool[data-panel="templates"]').click();
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

  await t.test('a document keeps its place when something in it changes', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Library');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.library-item');
    await page.waitForTimeout(400);
    const scroller = '.leaf > .leaf-scroll';
    // A short window, so the list is longer than the room and there is a place
    // to lose.
    await page.setViewportSize({ width: 1100, height: 420 });
    await page.waitForTimeout(400);
    // Half way, not the very bottom: a list that loses a row is shorter, and
    // the browser clamps a scroll position past the new end whatever the app
    // does about it.
    await page.evaluate((s) => {
      const el = document.querySelector(s);
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
    }, scroller);
    await page.waitForTimeout(200);
    const before = await page.evaluate((s) => document.querySelector(s).scrollTop, scroller);
    assert.ok(before > 40, `scrolled down the list (${before})`);
    // Removing a translation repaints the list; the reader stays where they were.
    await page.locator('.library-item .btn', { hasText: 'Remove' }).first().click();
    await page.waitForTimeout(1500);
    const after = await page.evaluate((s) => document.querySelector(s).scrollTop, scroller);
    assert.ok(Math.abs(after - before) < 60, `the page did not jump to the top (${before} → ${after})`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
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

  await t.test('nothing failed along the way', () => {
    assert.deepEqual(app.problems, []);
    // The English fixture has no language pack, which is the ordinary case the
    // app must survive; nothing else is allowed to be missing.
    assert.deepEqual(app.missing.filter((u) => !/lang\/iso-eng\.json$/.test(u)), []);
  });
});
