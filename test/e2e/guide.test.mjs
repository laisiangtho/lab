/**
 * The guide, as a reader meets it: not there until asked for, answering in
 * words and with a button, taking a passage for a passage, saying so when it
 * has nothing, remembering what helped, and forgetting it on request.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

const firstRun = async (page) => {
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });
};
const record = (page) => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('records').objectStore('records').get('guide'); q.onsuccess = () => r(q.result ?? null); });
});

test('the guide', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await firstRun(page);
  const ask = async (question) => {
    await page.locator('.gd-input').fill(question);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    return page.locator('.gd-x').last();
  };

  await t.test('it is not there until asked for, even after a restart', async () => {
    assert.equal(await page.locator('.guide').count(), 0);
    await page.reload();
    await page.waitForSelector('#app .body-row');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.guide').count(), 0, 'known, and still not placed');
  });

  await t.test('a question in the palette opens it with the answer', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('? how do I bookmark a verse');
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.modal-list .mi-t').first().innerText(), 'Ask the guide: how do I bookmark a verse');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.gd-card', { timeout: 10000 });
    assert.equal(await page.locator('.gd-card .gd-t').first().innerText(), 'Bookmark a verse');
    assert.match(await page.locator('.gd-card .gd-a').first().innerText(), /verse number/);
  });

  await t.test('its button does the thing, and that is remembered', async () => {
    await page.locator('.gd-card .gd-do').first().click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.pane-view[data-view="marks"].is-active').isVisible(), 'the Bookmarks pane is in front');
    const saved = await record(page);
    assert.equal(saved?.value?.pairs?.[0]?.id ?? saved?.pairs?.[0]?.id, 'topic.bookmark');
  });

  await t.test('a passage is answered with the passage', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('ask ps 23');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    const x = page.locator('.gd-x').last();
    await x.locator('.gd-do').waitFor();
    assert.match(await x.locator('.gd-t').innerText(), /Psalm 23/);
    await x.locator('.gd-do').click();
    await page.waitForTimeout(500);
    assert.match(await page.locator('.tabstrip .tab.is-active').innerText(), /Psalm 23|Psalms 23/);
  });

  await t.test('a question it cannot answer says so and offers a search', async () => {
    const x = await ask('quantum chromodynamics');
    assert.match(await x.locator('.gd-miss').innerText(), /Nothing in the guide answers that yet/);
    await x.locator('.gd-do', { hasText: 'Search the Bible' }).click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.search-pane > .field input').first().inputValue(), 'quantum chromodynamics');
  });

  await t.test('"Not this" is noted', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('? dark mode');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    const x = page.locator('.gd-x').last();
    await x.locator('.gd-fb-b', { hasText: 'Not this' }).click();
    assert.match(await x.locator('.gd-fb').innerText(), /Noted/);
  });

  await t.test('Settings forgets what it learned', async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Settings');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.settings');
    const row = page.locator('.set-row', { hasText: 'Learned from' });
    await row.scrollIntoViewIfNeeded();
    await row.locator('button', { hasText: 'Forget' }).click();
    await page.locator('.scrim:not([hidden]) .btn', { hasText: 'Forget' }).click();
    await page.waitForTimeout(400);
    assert.equal(await record(page), null);
    assert.ok(await page.locator('.set-row', { hasText: 'Nothing learned yet' }).isVisible());
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});

test('the guide on a phone keeps its field above the bar', options, async (t) => {
  const app = await launch({ viewport: { width: 390, height: 844 }, phone: true });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await firstRun(page);
  await page.keyboard.press('Control+p');
  await page.locator('.modal-input').fill('? getting started');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.gd-card', { timeout: 10000 });
  await page.waitForTimeout(400);
  const [field, bar] = await Promise.all([page.locator('.gd-foot').boundingBox(), page.locator('.mobile-bar').boundingBox()]);
  assert.ok(field.y + field.height <= bar.y, `the field ends (${Math.round(field.y + field.height)}) above the bar (${Math.round(bar.y)})`);
  assert.deepEqual(app.problems, []);
});

test('the guide downloads more answers', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await firstRun(page);
  await page.keyboard.press('Control+p');
  await page.locator('.modal-input').fill('? who wrote psalms');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.gd-x');

  await t.test('the greeting offers more, and they come from the repository', async () => {
    await page.locator('.gd-clear').click();
    assert.match(await page.locator('.gd-more-status').innerText(), /can be downloaded/);
    await page.locator('.gd-data-btn').click();
    await page.waitForFunction(() => /topics downloaded/.test(document.querySelector('.gd-more-status')?.textContent ?? ''), null, { timeout: 15000 });
    assert.ok(app.requests.some((url) => url.includes('api.github.com') && url.includes('/git/trees/')), 'the file list came from GitHub');
    assert.ok(!app.requests.some((url) => url.endsWith('README.md')), 'Markdown is not fetched');
    await page.locator('.gd-input').fill('who wrote psalms');
    await page.keyboard.press('Enter');
    const answer = page.locator('.gd-x').last().locator('.gd-card').first();
    await answer.waitFor();
    assert.match(await answer.locator('.gd-topic').innerText(), /psalms/i);
    assert.equal(await answer.locator('.gd-t').innerText(), 'Who wrote Psalms?');
  });

  await t.test('a downloaded answer\'s button goes to its passage', async () => {
    const answer = page.locator('.gd-x').last().locator('.gd-card').first();
    await answer.locator('.gd-do').click();
    await page.waitForTimeout(600);
    assert.match(await page.locator('.tabstrip .tab.is-active').innerText(), /Psalm 23/);
  });

  await t.test('the greeting says what is held, and Settings removes it', async () => {
    await page.locator('.gd-clear').click();
    assert.match(await page.locator('.gd-more-status').innerText(), /2 topics downloaded, 3 questions/);
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('Settings');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.settings');
    const row = page.locator('.set-row', { hasText: 'Downloaded answers' });
    await row.scrollIntoViewIfNeeded();
    await row.locator('button', { hasText: 'Remove' }).click();
    await page.waitForTimeout(300);
    const left = await page.evaluate(async () => {
      const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
      return new Promise((r) => { const q = db.transaction('guide').objectStore('guide').count(); q.onsuccess = () => r(q.result); });
    });
    assert.equal(left, 0);
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
