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
    // The question for the Guide pane first; the answers themselves under it
    // as rows that do the thing at once.
    await page.waitForFunction(() => [...document.querySelectorAll('.modal-list .mi-t')].some((el) => el.textContent === 'Bookmark a verse'));
    const rows = await page.locator('.modal-list .mi-t').allInnerTexts();
    assert.equal(rows[0], 'Ask the guide: how do I bookmark a verse');
    assert.equal(rows[1], 'Bookmark a verse', 'the best answer next');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.gd-card', { timeout: 10000 });
    assert.equal(await page.locator('.gd-card .gd-t').first().innerText(), 'Bookmark a verse');
    assert.match(await page.locator('.gd-card .gd-a').first().innerText(), /verse number/);
  });

  await t.test('"how can you help me?" is answered, and no answer is a title with nothing under it', async () => {
    const said = await ask('how can you help me?');
    await said.locator('.gd-card').first().waitFor();
    assert.equal(await said.locator('.gd-card .gd-t').first().innerText(), 'What the guide can help with');
    // Documents and commands are answers too; each has to say something.
    for (const question of ['how can you help me?', 'help', 'library', 'shortcuts', 'cards', 'voices', 'settings', 'palette', 'board']) {
      const block = await ask(question);
      const cards = block.locator('.gd-card');
      for (let i = 0; i < await cards.count(); i += 1) {
        const text = (await cards.nth(i).locator('.gd-a').innerText().catch(() => '')).trim();
        const title = await cards.nth(i).locator('.gd-t').innerText();
        assert.ok(text.length > 10, `"${question}" → "${title}" says something`);
      }
    }
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
    assert.match(await x.locator('.gd-miss').innerText(), /That one is beyond what I know/);
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
  const [field, bar] = await Promise.all([page.locator('.gd-foot').boundingBox(), page.locator('.ph-tabs').boundingBox()]);
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

test('Help is the same knowledge, laid out in the workspace', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await firstRun(page);
  await page.keyboard.press('Control+p');
  await page.locator('.modal-input').fill('Help');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.help-doc .hp-ask:not([hidden])');

  await t.test('a question at the top, no page title', async () => {
    assert.equal(await page.locator('.help-doc h1').count(), 0);
    const first = await page.locator('.help-doc > *:not([hidden])').first().getAttribute('class');
    assert.match(first, /hp-ask/);
  });

  await t.test('asked, it answers with the card the Guide pane draws', async () => {
    await page.locator('.hp-input').fill('how do I bookmark a verse');
    await page.keyboard.press('Enter');
    const card = page.locator('.hp-answers .gd-card').first();
    await card.waitFor();
    assert.equal(await card.locator('.gd-t').innerText(), 'Bookmark a verse');
    assert.equal(await page.locator('.hp-answers .gd-miss .gd-do', { hasText: 'Help' }).count(), 0, 'Help does not offer itself');
    await card.locator('.gd-do').click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.pane-view[data-view="marks"].is-active').isVisible(), 'the button did it');
    const saved = await record(page);
    assert.equal(saved?.value?.pairs?.[0]?.id ?? saved?.pairs?.[0]?.id, 'topic.bookmark', 'and the guide learned it');
  });

  await t.test('every written topic is there to browse, and each one answers', async () => {
    const topics = page.locator('.hp-topic');
    assert.ok(await topics.count() >= 20, `${await topics.count()} topics`);
    for (const name of ['Study a word', 'Hebrew and Greek texts', 'Interlinear line']) {
      await page.locator('.hp-topic', { hasText: name }).click();
      await page.waitForFunction((title) => document.querySelector('.hp-answers .gd-x .gd-t')?.textContent === title, name);
      const card = page.locator('.hp-answers .gd-x').first().locator('.gd-card');
      assert.ok((await card.locator('.gd-a').innerText()).length > 40, `${name} says something`);
    }
    assert.ok(await page.locator('.hp-answers .gd-x').count() <= 3, 'a few answers, not a transcript');
  });

  await t.test('the downloadable answers are offered here too', async () => {
    assert.match(await page.locator('.hp-data .gd-more-status').innerText(), /can be downloaded/);
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
