/**
 * Importing a file, typed into as a reader types: a key at a time.
 *
 * The dialog re-read the file after every answer, so each keystroke put the
 * file's own guess back in the box — an empty one for an OSIS name, which
 * made the boxes look disabled. The suite's other import test fills a box in
 * one step and never read it back, which is how that went unnoticed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

const verses = Array.from({ length: 31 }, (_, i) => `<verse osisID='Gen.1.${i + 1}'><w lemma='strong:H7225'>בְּרֵאשִׁ֖ית</w> בָּרָ֣א אֱלֹהִ֑ים ${i + 1}</verse>`).join('\n');
const BHS = `<?xml version='1.0' encoding='UTF-8'?>
<osis xmlns='http://www.bibletechnologies.net/2003/OSIS/namespace'>
  <osisText osisRefWork='Bible' osisIDWork='bhs' xml:lang='he'>
    <header><work osisWork='bhs'><title>Biblia hebraica</title></work></header>
    <div type='book' osisID='Gen'><chapter osisID='Gen.1'>${verses}</chapter></div>
  </osisText>
</osis>`;

test('the import dialog, typed into', options, async (t) => {
  const app = await launch({ viewport: { width: 1280, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.lib-tab[aria-selected="true"]');
  await page.locator('.lib-tab[data-page="more"]').click();
  await page.locator('.lib-src[data-source="file"]').click();

  const chooser = page.waitForEvent('filechooser');
  await page.locator('.lib-panel .btn.primary').click();
  await (await chooser).setFiles({ name: 'bhs.xml', mimeType: 'text/xml', buffer: Buffer.from(BHS) });
  await page.waitForSelector('.fd');
  const box = (id) => page.locator(`.fd-row[data-field="${id}"] input`);

  await t.test('it is filled from the file', async () => {
    assert.equal(await box('name').inputValue(), 'Biblia hebraica', 'the OSIS header title');
    assert.equal(await box('identify').inputValue(), 'bhs');
    assert.equal(await box('language').inputValue(), 'he');
  });

  await t.test('what is typed stays typed', async () => {
    await box('name').click();
    await box('name').press('End');
    await box('name').pressSequentially(' Stuttgartensia', { delay: 20 });
    assert.equal(await box('name').inputValue(), 'Biblia hebraica Stuttgartensia');
    await box('identify').fill('');
    await box('identify').pressSequentially('bhs2', { delay: 20 });
    assert.equal(await box('identify').inputValue(), 'bhs2');
    await box('language').fill('');
    await box('language').pressSequentially('heb', { delay: 20 });
    assert.equal(await box('language').inputValue(), 'heb');
  });

  await t.test('choosing another format fills the boxes for that format', async () => {
    await page.locator('.fd-opt', { hasText: 'USFM' }).click();
    assert.equal(await box('name').inputValue(), '', 'USFM finds no name in this file');
    await page.locator('.fd-opt', { hasText: /XML/ }).click();
    assert.equal(await box('name').inputValue(), 'Biblia hebraica', 'and back again');
    await box('name').click();
    await box('name').press('End');
    await box('name').pressSequentially(' (BHS)', { delay: 20 });
    assert.equal(await box('name').inputValue(), 'Biblia hebraica (BHS)');
  });

  await t.test('it imports under what was typed, written right to left', async () => {
    await page.locator('.fd-acts .btn.primary').click();
    await page.waitForSelector('.library-item[data-identify="bhs"]', { timeout: 20000 });
    assert.match(await page.locator('.library-item[data-identify="bhs"]').innerText(), /Biblia hebraica \(BHS\)/);
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('gen 1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.verse');
    const dir = await page.evaluate(() => document.querySelector('.verse')?.closest('[dir]')?.getAttribute('dir'));
    assert.equal(dir, 'rtl');
  });

  await t.test('nothing went wrong on the way', () => assert.deepEqual(app.problems, []));
});
