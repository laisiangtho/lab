/**
 * Exporting a translation, as a reader does it: the dialog, what it offers for
 * this translation and this format, what it remembers, and what actually lands
 * in the downloads folder — opened and read, not taken on trust.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { openZip } from '../../app/services/zip.js';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

test('exporting a translation', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 } });
  const { page } = app;
  t.after(() => app.close());

  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await installFromLibrary(page, 'kjv1611');

  // A note of the reader's own, on Genesis 1:1, then a restart to load it.
  await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('lai-siangtho'); q.onsuccess = () => r(q.result); });
    const at = new Date().toISOString();
    await new Promise((r) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put({ id: 'n-export', book: 1, chapter: 1, verse: 1, to: null, text: 'Light before the sun.', created: at, updated: at });
      tx.oncomplete = r;
    });
  });
  await page.reload();
  await page.waitForSelector('#app .body-row');
  await page.keyboard.press('Control+p');
  await page.locator('.modal-input').fill('Library');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  // Home: what is on this device.
  await page.waitForSelector('.library-item[data-identify="kjv1611"]');

  const openDialog = async () => {
    await page.locator('.library-item[data-identify="kjv1611"] .lib-act[aria-haspopup="menu"]').click();
    await page.locator('.menu .menu-item', { hasText: 'Export' }).click();
    await page.waitForSelector('.fd');
    await page.waitForTimeout(600);
  };
  const shown = (field) => page.locator(`.fd [data-field="${field}"]`).isVisible();
  const chips = () => page.locator('.fd-chip:visible').allInnerTexts();
  const save = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.fd .btn.primary').click()]);
    return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
  };

  await t.test('only what means something is offered', async () => {
    await openDialog();
    // The fixture carries cross-references and neither headings nor Strong's
    // numbers; notes are not something JSON holds.
    assert.deepEqual((await chips()).map((c) => c.replace(/^✓\s*/, '')), ['Cross-references']);
    assert.ok(await shown('output'), 'JSON has a layout to choose');
    assert.ok(!(await shown('names')), 'and no book names to choose');
    await page.locator('.fd [data-field="format"] select').selectOption('markdown');
    await page.waitForTimeout(200);
    assert.ok(!(await shown('output')), 'Markdown has no minified form');
    assert.ok(await shown('names'));
    assert.deepEqual((await chips()).map((c) => c.replace(/^✓\s*/, '')), ['Cross-references', 'Your notes']);
    assert.equal(await page.locator('.fd [data-field="pack"] select').inputValue(), 'zip', 'sixty-six books in Markdown are a zip');
    assert.ok(await page.locator('.fd [data-field="pack"] select').isDisabled(), 'and there is nothing else to choose');
    await page.keyboard.press('Escape');
  });

  await t.test('compact JSON, gzipped', async () => {
    await openDialog();
    await page.locator('.fd [data-field="format"] select').selectOption('native');
    await page.locator('.fd [data-field="output"] select').selectOption('compact');
    await page.locator('.fd [data-field="pack"] select').selectOption('gzip');
    assert.match(await page.locator('.fd-live').innerText(), /About [\d.]+ KB/);
    const file = await save();
    assert.equal(file.name, 'kjv1611.json.gz');
    const text = gunzipSync(file.bytes).toString('utf8');
    assert.equal(text.trimEnd().split('\n').length, 1, 'one line');
    const json = JSON.parse(text);
    assert.equal(json.identify, 'kjv1611');
    assert.ok(json.book[1]?.chapter?.[1]?.verse?.[1]?.text, 'Genesis 1:1 is in it');
  });

  await t.test('the choices are remembered', async () => {
    await openDialog();
    assert.equal(await page.locator('.fd [data-field="format"] select').inputValue(), 'native');
    assert.equal(await page.locator('.fd [data-field="output"] select').inputValue(), 'compact');
    assert.equal(await page.locator('.fd [data-field="pack"] select').inputValue(), 'gzip');
    await page.keyboard.press('Escape');
  });

  await t.test('one book in Markdown, with the reader\'s notes and no references', async () => {
    await openDialog();
    await page.locator('.fd [data-field="format"] select').selectOption('markdown');
    await page.locator('.fd-free').fill('Genesis');
    await page.waitForTimeout(150);
    await page.locator('.fd-chip', { hasText: 'Your notes' }).click();
    await page.locator('.fd-chip', { hasText: 'Cross-references' }).click();
    await page.locator('.fd [data-field="pack"] select').selectOption('file');
    const file = await save();
    assert.equal(file.name, '01-GEN-kjv1611.md');
    const text = file.bytes.toString('utf8');
    assert.match(text, /\*\*1\*\* [^\n]+\n\n> \*\*Note\*\* Light before the sun\./, 'the note under its verse');
    assert.doesNotMatch(text, /\n> (?!\*\*Note)[A-Z][a-z]+ \d/, 'no cross-reference lines');
  });

  await t.test('a zip is compressed and carries the copyright beside the files', async () => {
    await openDialog();
    await page.locator('.fd [data-field="format"] select').selectOption('usfm');
    await page.locator('.fd-opt', { hasText: 'New Testament' }).click();
    const file = await save();
    assert.equal(file.name, 'kjv1611-usfm.zip');
    const zip = openZip(file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength));
    // The fixture holds a few books; every one of them in the New Testament
    // is a file, and ABOUT.txt goes with them.
    assert.ok(zip.length >= 2, `${zip.length} entries`);
    assert.ok(zip.filter((entry) => entry.name !== 'ABOUT.txt').every((entry) => /^(4\d|5\d|6\d)-[A-Z0-9]{3}-kjv1611\.usfm$/.test(entry.name)),
      zip.map((entry) => entry.name).join(', '));
    assert.ok(zip.every((entry) => entry.compressed <= entry.size));
    assert.ok(zip.some((entry) => entry.compressed < entry.size / 1.5), 'really compressed');
    const about = await zip.find((entry) => entry.name === 'ABOUT.txt').text();
    assert.match(about, /King James Version/);
    assert.match(about, /Copyright/);
  });

  await t.test('a passage prints as a styled sheet, from a frame rather than a window', async () => {
    await page.keyboard.press('Escape');
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.vblock[data-verse="1"]');
    // The frame is caught as it is added, and its print() answered here: what
    // the dialog would have shown is read instead of a dialog opening.
    await page.evaluate(() => {
      window.__sheet = null;
      new MutationObserver((changes) => {
        for (const change of changes) for (const node of change.addedNodes) {
          if (node.tagName !== 'IFRAME') continue;
          node.contentWindow.print = () => {
            const doc = node.contentDocument;
            const style = node.contentWindow.getComputedStyle(doc.body);
            window.__sheet = { font: style.fontFamily, title: doc.querySelector('h1')?.textContent, verses: doc.querySelectorAll('p.v').length };
            node.contentWindow.dispatchEvent(new Event('afterprint'));
          };
        }
      }).observe(document.body, { childList: true });
    });
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('export gen 1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.locator('.modal-list .mi[data-id="sheet"]').click();
    await page.waitForFunction(() => window.__sheet !== null, null, { timeout: 5000 });
    const sheet = await page.evaluate(() => window.__sheet);
    assert.match(sheet.font, /Georgia/, 'the sheet\'s own stylesheet applies, though the content policy refuses <style>');
    assert.match(sheet.title, /Genesis 1/);
    assert.equal(sheet.verses, 31);
    assert.equal(page.context().pages().length, 1, 'no window was opened');
    await page.waitForFunction(() => !document.querySelector('body > iframe'), null, { timeout: 2000 });
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
