/**
 * What a translation carries besides its words — Strong's numbers, headings,
 * cross-references — shown on the reading surface when asked for, and nowhere
 * else ever: not on a card, not in a search result, not in the verse of the
 * day, not in a word count.
 *
 * The Danish fixture carries a Strong's number on verse 1, the edition's own
 * number past the end of the lexicon (H9999, as eBible.org's tagged Judson
 * writes it) on verse 2, and a sense letter (H1254a) on verse 3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

/** Any of the stored notation on screen, anywhere. */
const RAW = /\{[HG]\d|<S>\d|\[[HG]\d/;

test("Strong's numbers and the rest of the markup", options, async (t) => {
  const app = await launch({ viewport: { width: 1440, height: 900 } });
  const { page } = app;
  t.after(() => app.close());
  // Every string drawn on a canvas, so a card can be read back.
  await page.addInitScript(() => {
    window.__drawn = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function patched(text, ...rest) {
      window.__drawn.push(String(text));
      return fill.call(this, text, ...rest);
    };
  });
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  await page.locator('.wl .btn.primary').click();
  await installFromLibrary(page, 'ddb1931');
  await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
  await page.waitForSelector('.verse');
  const palette = async (text) => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(text);
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  };
  const bodyText = () => page.evaluate(() => document.body.innerText);

  await t.test('switched off, the text reads as words and nothing else', async () => {
    const text = await page.locator('.chapter').first().innerText();
    assert.doesNotMatch(text, RAW);
    assert.match(text, /Dansk 1:1 tekst\./);
    assert.doesNotMatch(await bodyText(), RAW, 'nor anywhere else on screen');
  });

  await t.test("switched on, Strong's numbers are words to press; the edition's own are not", async () => {
    await palette("Strong's numbers");
    await page.waitForSelector('.strongs-code');
    const codes = await page.locator('.chapter .strongs-code').allInnerTexts();
    assert.ok(codes.includes('H7225'), `H7225 is shown (${codes})`);
    assert.ok(codes.includes('H1254A'), 'a sense letter is kept, in capitals');
    assert.ok(!codes.includes('H9999'), 'H9999 leads to no lexicon entry and is not offered as one');
    assert.doesNotMatch(await bodyText(), RAW, 'the stored notation never shows');
  });

  await t.test('in the list layout a tagged word stays inside its verse', async () => {
    // The list layout is a two-column grid: the number, and the text. A verse
    // whose text was several pieces put the tagged word in a cell of its own.
    const layoutOf = () => page.evaluate(() => { const c = document.querySelector('.chapter').classList; return c.contains('list') ? 'list' : c.contains('flow') ? 'flow' : 'paragraph'; });
    for (let i = 0; i < 3 && (await layoutOf()) !== 'list'; i += 1) await palette('Verse layout');
    assert.equal(await layoutOf(), 'list');
    const cells = await page.locator('.chapter.list .verse').evaluateAll((verses) => verses.map((v) => v.children.length));
    assert.ok(cells.length && cells.every((n) => n === 2), `every verse is a number and one text (${[...new Set(cells)]})`);
    const [word, text] = await page.evaluate(() => {
      const verse = document.querySelector('.chapter.list .verse');
      return [verse.querySelector('.strongs').getBoundingClientRect().top, verse.querySelector('.vtext').getBoundingClientRect().top];
    });
    assert.ok(Math.abs(word - text) < 12, 'the tagged word is on the first line of its verse');
    for (let i = 0; i < 3 && (await layoutOf()) !== 'paragraph'; i += 1) await palette('Verse layout');
  });

  await t.test('the translation says what it carries', async () => {
    await page.locator('.tr-btn[aria-label="About this translation"]').first().click();
    await page.waitForSelector('.tri-facts');
    const info = await page.locator('.tri-facts').innerText();
    assert.match(info, /Strong.s numbers/i);
    assert.match(await page.locator('.tri-note').innerText(), /H9999 ×\d+ is the edition.s own number/);
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 500);
  });

  await t.test('a search reads the words, and a number finds the words tagged with it', async () => {
    await palette('find tekst.');
    await page.waitForSelector('.sr-count', { timeout: 20000 });
    await page.waitForTimeout(800);
    assert.doesNotMatch(await bodyText(), RAW, 'no result shows the notation');
    await palette('find H7225');
    await page.waitForTimeout(1500);
    const pane = await bodyText();
    assert.match(pane, /Dansk \d+:1 tekst/, 'verse 1 of a chapter is found by its number');
    assert.doesNotMatch(pane, RAW);
  });

  await t.test('a card is drawn from the words', async () => {
    await page.evaluate(() => { window.__drawn = []; });
    await palette('Cards');
    await page.waitForSelector('.cd-canvas');
    await page.waitForTimeout(800);
    const drawn = await page.evaluate(() => window.__drawn.join(' '));
    assert.match(drawn, /tekst/, 'the card was drawn');
    assert.doesNotMatch(drawn, /\{|H7225|H9999|H1254/, `no number reached the card: ${drawn.slice(0, 200)}`);
  });

  await t.test('headings and cross-references switch off and on, each on its own', async () => {
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.verse');
    assert.ok(await page.locator('.chapter .xrefs').count(), 'Genesis 1:1 carries a reference line');
    await palette('Cross-references');
    assert.equal(await page.locator('.chapter .xrefs').count(), 0, 'gone when switched off');
    assert.ok(await page.locator('.chapter .strongs-code').count(), "and Strong's numbers are untouched");
    await palette('Cross-references');
    assert.ok(await page.locator('.chapter .xrefs').count(), 'back when switched on');

    await palette('exo 3');
    await page.waitForSelector('.verse-title');
    await palette('Section headings');
    assert.equal(await page.locator('.chapter .verse-title, .chapter .story-head').count(), 0);
    await page.reload();
    await page.waitForSelector('.verse');
    assert.equal(await page.locator('.chapter .verse-title').count(), 0, 'and it is remembered');
    await palette('Section headings');
    assert.ok(await page.locator('.chapter .verse-title').count());
  });

  await t.test('pressed twice, the message is the newest one, not both', async () => {
    await palette("Strong's numbers");
    await palette("Strong's numbers");
    const said = await page.locator('.toast').allInnerTexts();
    assert.equal(said.filter((text) => /Strong/.test(text)).length, 1, `one message about it: ${JSON.stringify(said)}`);
  });

  await t.test('nothing was logged', () => {
    assert.deepEqual(app.problems, []);
  });
});
