/**
 * The app around the reading: messages that carry what to do next, the
 * status bar arranged like the ribbon, the menu in the ribbon's corner, the
 * tint on words with Strong's numbers, the walkthrough, and the guide
 * answering what it can work out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('around the reading', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  // A new reader, as far as the walkthrough can tell: the automated browser
  // otherwise keeps it from starting on its own.
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const palette = async (text) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  const toast = (text) => page.locator('.toast', { hasText: text });

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  for (const id of ['kjv1611', 'ddb1931']) {
    await page.locator(`[data-identify="${id}"] .library-actions .btn`).click();
    await page.locator(`[data-identify="${id}"] .badge-ok`).waitFor({ timeout: 60000 });
  }

  await t.test('a message says what can be done next, and does it', async () => {
    const said = toast('Det Danske Bibel');
    await said.waitFor();
    assert.equal(await said.locator('.toast-act').innerText(), 'Read it');
    await said.locator('.toast-act').click();
    await page.waitForSelector('.leaf[data-role="primary"] .vblock');
    assert.equal(await page.locator('.leaf[data-role="primary"]').getAttribute('data-translation'), 'ddb1931');
  });

  await t.test('the walkthrough starts once, on its own, and can be left at any step', async () => {
    await page.waitForSelector('.tour-card', { timeout: 10000 });
    assert.match(await page.locator('.tour-t').innerText(), /A short walk round/);
    await page.locator('.tour-acts .btn.primary').click();
    await page.waitForFunction(() => document.querySelector('.tour')?.dataset.step === 'reading');
    const ring = await page.locator('.tour-ring').boundingBox();
    const chapter = await page.locator('.leaf[data-role="primary"] .chapter').boundingBox();
    assert.ok(Math.abs(ring.x - (chapter.x - 6)) < 3, 'the ring is on what the step names');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.tour')?.dataset.step === 'verse');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.tour')?.dataset.step === 'reading');
    // Steps for what is not on screen are passed over: a desktop has no phone bar.
    const seen = [];
    for (let i = 0; i < 14 && await page.locator('.tour').count(); i += 1) {
      seen.push(await page.locator('.tour').getAttribute('data-step'));
      await page.locator('.tour-acts .btn.primary').click();
      await page.waitForTimeout(120);
    }
    assert.ok(!seen.includes('phone'), `no phone step on a desktop: ${seen.join(', ')}`);
    assert.ok(seen.includes('status') && seen.includes('menu'), seen.join(', '));
    assert.equal(await page.locator('.tour').count(), 0, 'Done ends it');
    await page.reload();
    await page.waitForSelector('.leaf .vblock');
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.tour').count(), 0, 'and it does not start again');
  });

  await t.test('the menu in the ribbon\'s corner, and the tour again from it', async () => {
    await page.locator('.rib-menu').click();
    const rows = await page.locator('.menu [role="menuitem"], .menu button').allInnerTexts();
    assert.ok(rows.some((row) => /Take the tour/.test(row)), rows.join(' | '));
    assert.ok(rows.some((row) => /Settings/.test(row)), rows.join(' | '));
    await page.locator('.menu button', { hasText: 'Take the tour' }).click();
    await page.waitForSelector('.tour-card');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.tour').count(), 0, 'Esc ends it');
  });

  await t.test('the status bar: an icon for every item, and each can be taken off and put back', async () => {
    const items = () => page.locator('.statusbar [data-status]').evaluateAll((els) => els.map((el) => el.dataset.status));
    assert.deepEqual(await items(), ['translation', 'passage', 'words', 'verses', 'reading', 'mode', 'strongs', 'sync', 'storage']);
    assert.equal(await page.locator('.statusbar [data-status] svg').count(), 9, 'every item has its icon');
    assert.equal(await page.locator('.statusbar [data-status="sync"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.statusbar [data-status="words"]').click({ button: 'right' });
    await page.locator('.menu button', { hasText: 'off the status bar' }).click();
    assert.ok(!(await items()).includes('words'));
    await toast('off the status bar').waitFor();
    const bar = await page.locator('.statusbar').boundingBox();
    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2, { button: 'right' });
    await page.locator('.menu button', { hasText: 'Add to the status bar' }).click();
    await page.locator('.modal-list .mi-t', { hasText: 'Word count' }).click();
    assert.deepEqual((await items()).slice(0, 4), ['translation', 'passage', 'words', 'verses'], 'back in its place');
    await page.reload();
    await page.waitForSelector('.statusbar [data-status]');
    assert.equal((await items()).length, 9);
  });

  await t.test('words carrying a number are tinted while the numbers are hidden', async () => {
    await palette('gen 1');
    const word = page.locator('.leaf[data-role="primary"] .strongs.is-hidden-code').first();
    await word.waitFor();
    const colour = () => word.evaluate((el) => getComputedStyle(el).color);
    const plain = await page.locator('.leaf[data-role="primary"] .vtext').first().evaluate((el) => getComputedStyle(el).color);
    assert.notEqual(await colour(), plain);
    await palette('Tint words with numbers');
    assert.equal(await colour(), plain, 'and not when turned off');
    await palette('Tint words with numbers');
  });

  await t.test('the guide works out the time, the counts and where the reading is', async () => {
    const ask = async (question) => {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(`? ${question}`);
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      const block = page.locator('.gd-x').last();
      await page.waitForFunction((q) => document.querySelector('.gd-x:last-child .gd-q')?.textContent === q, question);
      await block.locator('.gd-card').first().waitFor();
      return block;
    };
    assert.match(await (await ask('how many chapters in Psalms?')).locator('.gd-t').innerText(), /^150 chapters in \S/);
    assert.match(await (await ask('how many verses in john 3')).locator('.gd-t').innerText(), /^36 verses in John 3$/);
    assert.match(await (await ask('how many books are in the bible')).locator('.gd-t').innerText(), /^66 books$/);
    assert.match(await (await ask('how many verses in the bible')).locator('.gd-t').innerText(), /^31,1\d\d verses$/);
    assert.match(await (await ask('what time is it?')).locator('.gd-t').innerText(), /^It is \d/);
    assert.match(await (await ask('where am I?')).locator('.gd-t').innerText(), /^You are reading /);
    const who = await ask('who are you?');
    assert.match(await who.locator('.gd-a').innerText(), /not an AI model/);
    assert.match(await (await ask('how many chapters in narnia')).locator('.gd-t').innerText(), /No book called “narnia”/);
    const miss = await ask('why is the sky blue');
    assert.match(await miss.locator('.gd-miss .gd-a').innerText(), /beyond what I know/);
    const tour = await ask('play the walkthrough again');
    await tour.locator('.gd-do').click();
    await page.waitForSelector('.tour-card');
    await page.keyboard.press('Escape');
  });

  await t.test('a download that fails says why, with what works instead', async () => {
    // A site that answers but sends no CORS header: the browser refuses the
    // page's read (stood in for by failing the request), while a request
    // asking for nothing back is answered.
    let asked = 0;
    await page.route('https://a.openbible.info/**', (route) => {
      asked += 1;
      return asked === 1 ? route.abort('failed') : route.fulfill({ status: 200, body: '' });
    });
    await palette('Library: Study data');
    await page.locator('[data-get="openbible"]').click();
    const said = toast('does not allow a web page to read the file');
    await said.waitFor({ timeout: 15000 });
    assert.deepEqual(await said.locator('.toast-act').allInnerTexts(), ['Open the page', 'Add the file']);
    await page.mouse.move(5, 5);
    await said.locator('.toast-x').click();
  });

  await t.test('nothing went wrong on the way', () => {
    assert.deepEqual(app.problems.filter((p) => !/CORS|Access-Control-Allow-Origin|net::ERR_FAILED/.test(p)), []);
  });
});
