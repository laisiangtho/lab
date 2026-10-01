/**
 * Study data: cross-references, a Bible dictionary and a topical index got
 * from the Library's Study data page, then used — the links under a verse,
 * an article with its verses, the topics a chapter is filed under — and
 * removed again. The publishers are answered from test/fixtures/studydata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('study data', options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  const palette = async (text) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  const group = (type) => page.locator(`.sd-group[data-type="${type}"]`);

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
  await page.locator('[data-identify="kjv1611"] .library-actions .btn').click();
  await page.locator('[data-identify="kjv1611"] .badge-ok').waitFor({ timeout: 60000 });

  await t.test('the Study data page: each kind, with where to get it', async () => {
    await page.locator('.lib-tab[data-page="study"]').click();
    await page.waitForSelector('.sd-group');
    assert.deepEqual(await page.locator('.sd-group').evaluateAll((els) => els.map((el) => el.dataset.type)), ['crossrefs', 'topics', 'dictionary']);
    assert.equal(await page.locator('.sd-item').count(), 0, 'nothing here yet');
    assert.match(await group('crossrefs').innerText(), /OpenBible\.info/);
    assert.equal(await group('crossrefs').locator('.sd-source a').getAttribute('href'), 'https://www.openbible.info/labs/cross-references/');
  });

  await t.test('cross-references: got, kept, and counted', async () => {
    await group('crossrefs').locator('[data-get="openbible"]').click();
    await group('crossrefs').locator('.sd-item').waitFor({ timeout: 30000 });
    const item = await group('crossrefs').locator('.sd-item').innerText();
    assert.match(item, /OpenBible\.info cross-references/);
    assert.match(item, /112 links/);
    assert.match(item, /CC BY/);
    assert.match(await page.locator('.lib-tab[data-page="study"]').innerText(), /1/);
  });

  await t.test('a dictionary and a topical index: the publisher says which', async () => {
    await group('dictionary').locator('[data-get="easton"]').click();
    await group('dictionary').locator('.sd-item').waitFor({ timeout: 30000 });
    assert.match(await group('dictionary').locator('.sd-item').innerText(), /6 articles/);
    assert.equal(await page.locator('.fd-row[data-field="type"]').count(), 0, 'nothing to ask');
    await group('topics').locator('[data-get="nave"]').click();
    await group('topics').locator('.sd-item').waitFor({ timeout: 30000 });
    assert.match(await group('topics').locator('.sd-item').innerText(), /4 topics/);
  });

  await t.test('a file of one\'s own: a ThML work is asked about, and replaces one of its name', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.lib-bar-acts .lib-act').first().click();
    await (await chooser).setFiles({ name: 'ebd2.xml', mimeType: 'text/xml', buffer: readFileSync(new URL('../fixtures/studydata/easton-a-extract.xml', import.meta.url)) });
    await page.waitForSelector('.fd-row[data-field="type"]');
    assert.match(await page.locator('.fd-lede').innerText(), /Easton's Bible Dictionary/);
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => /6 entries kept/.test(el.textContent)));
    assert.equal(await group('dictionary').locator('.sd-item').count(), 1, 'the same work, kept once');
  });

  await t.test('under a verse: the most voted first, the rest a press away', async () => {
    await palette('gen 1');
    await page.waitForSelector('.vblock[data-verse="1"] .xrefs.is-study');
    const line = page.locator('.vblock[data-verse="1"] .xrefs.is-study');
    const shown = await line.locator('.xref:not(.xref-more)').count();
    assert.equal(shown, 6);
    assert.match(await line.locator('.xref').first().innerText(), / 1:1–3$/, 'John 1:1–3 has the most votes for Genesis 1:1');
    await line.locator('.xref-more').click();
    assert.ok(await line.locator('.xref').count() > 6, 'and the rest shown');
    assert.equal(await line.locator('.xref-more').count(), 0);
    await page.locator('.vblock[data-verse="3"] .xrefs.is-study .xref').first().click();
    await page.waitForTimeout(600);
    assert.notEqual(await page.evaluate(() => document.querySelector('.crumb')?.textContent ?? ''), '');
  });

  await t.test('the cross-reference setting hides them too', async () => {
    await palette('gen 1');
    await page.waitForSelector('.xrefs.is-study');
    await palette('Cross-references');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.xrefs.is-study').count(), 0);
    await palette('Cross-references');
    await page.waitForSelector('.xrefs.is-study');
  });

  await t.test('the dictionary: "define aaron" opens the article, its verses links', async () => {
    await palette('define aaron');
    await page.waitForSelector('.rf .rf-entry-t');
    assert.equal(await page.locator('.rf .rf-entry-t').innerText(), 'Aaron');
    assert.match(await page.locator('.rf .rf-article').innerText(), /eldest son of Amram/);
    const ref = page.locator('.rf .rf-article .ws-ref').first();
    assert.match(await ref.innerText(), /Exodus 6:20/);
    await ref.click();
    await page.waitForSelector('.vblock[data-verse="20"]');
    assert.match(await page.locator('.crumbs').first().innerText(), /Exodus/);
    await page.locator('.rf-back').click();
    await page.locator('.rf-q').fill('ab');
    await page.waitForTimeout(300);
    assert.deepEqual(await page.locator('.rf-term').evaluateAll((els) => els.map((el) => el.dataset.term)), ['Abaddon', 'Abagtha', 'Abana']);
  });

  await t.test('topics: the chapter being read, and a subject searched for', async () => {
    await palette('gen 1');
    await page.locator('.rf-tab[data-mode="topics"]').click();
    await page.waitForSelector('.rf-term');
    const terms = await page.locator('.rf-term').evaluateAll((els) => els.map((el) => el.dataset.term));
    assert.deepEqual(terms, ['Creation', 'Light', 'Darkness'], 'by how many of the chapter\'s verses each covers');
    await page.locator('.rf-term[data-term="Light"]').click();
    assert.match(await page.locator('.rf-refs').innerText(), /Genesis 1:3–5/);
    assert.equal(await page.locator('.rf-refs .ws-ref').count(), 5);
    await palette('topic prayer');
    await page.waitForSelector('.rf .rf-entry-t');
    assert.equal(await page.locator('.rf .rf-entry-t').innerText(), 'Prayer');
  });

  await t.test('the guide answers from the study data and the translation', async () => {
    const ask = async (question) => {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(`? ${question}`);
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await page.waitForFunction((q) => document.querySelector('.gd-x:last-child .gd-q')?.textContent === q, question);
      const block = page.locator('.gd-x').last();
      await block.locator('.gd-card').first().waitFor();
      return block;
    };
    const aaron = await ask('who was Aaron?');
    const card = aaron.locator('.gd-card').first();
    assert.equal(await card.locator('.gd-t').innerText(), 'Aaron');
    assert.match(await card.locator('.gd-topic').innerText(), /Bible dictionary/i);
    assert.match(await card.locator('.gd-a').innerText(), /eldest son of Amram/);
    await card.locator('.gd-do').click();
    await page.waitForSelector('.rf .rf-entry-t');
    assert.equal(await page.locator('.rf .rf-entry-t').innerText(), 'Aaron', 'Read the article opens it');

    const light = await ask('verses about light');
    assert.equal(await light.locator('.gd-card .gd-t').first().innerText(), 'Light');
    assert.match(await light.locator('.gd-card .gd-a').first().innerText(), /5 verses listed/);

    const verse = await ask('gen 1:1');
    await verse.locator('.gd-verse').first().waitFor();
    assert.match(await verse.locator('.gd-verse').first().innerText(), /Genesis 1:1 in English/, 'the words, in the translation being read');
    await verse.locator('.gd-link').first().waitFor();
    assert.match(await verse.locator('.gd-links').innerText(), /Cross-references/);
    assert.ok(await verse.locator('.gd-link').count() >= 5, 'and the imported cross-references from it');

    const none = await ask('what is source mode');
    assert.notEqual(await none.locator('.gd-card .gd-t').first().innerText(), 'source mode', 'not a subject the sets have: the guide\'s own answer');
  });

  await t.test('a set removed is gone from the reading too', async () => {
    await palette('Library: Study data');
    await page.waitForSelector('.sd-group .sd-item', { timeout: 5000 }).catch(async () => {
      throw new Error(`the Study data page did not open: ${await page.locator('.modal-input').inputValue().catch(() => '')} ${await page.title()}`);
    });
    await group('crossrefs').locator('.sd-item .lib-act').click();
    await page.locator('.confirm .cf-acts .btn').last().click();
    await page.waitForFunction(() => !document.querySelector('.sd-group[data-type="crossrefs"] .sd-item'));
    await palette('gen 1');
    await page.waitForSelector('.vblock[data-verse="1"]');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.xrefs.is-study').count(), 0);
  });

  await t.test('nothing went wrong on the way', () => {
    assert.deepEqual(app.problems, []);
  });
});
