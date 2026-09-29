/**
 * Measurements at the edges, against full-size data.
 *
 * Not a test: it asserts nothing and fails nothing. It prints what the app
 * costs where cost is most likely — installing a whole Bible, the longest
 * chapter there is, four of them side by side, and a search across everything
 * held — so a change that makes one of them worse can be seen.
 *
 *   node test/e2e/perf.mjs
 *
 * The fixtures carry the canon's real chapter and verse counts, so the sizes
 * are the sizes a reader would have; only the verse text is invented.
 */

import { available, fixtures, launch } from './harness.mjs';

const ready = await available();
if (!ready.ok) {
  console.error(`skipped: ${ready.why}`);
  process.exit(0);
}

const app = await launch({ fixtures: fixtures({ books: 'all' }) });
const { page } = app;

const time = async (label, fn) => {
  const started = Date.now();
  const extra = await fn();
  const ms = Date.now() - started;
  console.log(`${String(ms).padStart(6)} ms  ${label}${extra ? `  (${extra})` : ''}`);
  return ms;
};

await time('start with nothing installed', async () => {
  await app.open();
  // A brand-new install opens on the welcome screen, which is what a reader
  // sees; the measurement is of reaching the catalog from there.
  await page.waitForSelector('.wl, .library-item');
  if (await page.locator('.wl .btn.primary').count()) await page.locator('.wl .btn.primary').click();
  await page.waitForSelector('.library-item');
});

for (const identify of ['kjv1611', 'judson1835', 'ddb1931']) {
  await time(`install ${identify}`, async () => {
    await page.locator(`[data-identify="${identify}"] button`, { hasText: 'Make available offline' }).click();
    await page.locator(`[data-identify="${identify}"] .badge-ok`).waitFor({ timeout: 300000 });
    return page.locator(`[data-identify="${identify}"] .lib-held`).innerText();
  });
}

await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
await page.waitForSelector('.verse');

const open = async (reference, verses) => time(`open ${reference}`, async () => {
  await page.keyboard.press('Control+o');
  await page.locator('.modal-input').fill(reference);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.verse').length >= n, verses, { timeout: 60000 });
  return `${await page.locator('.verse').count()} verses`;
});

await open('Psalm 119', 176);
await time('next chapter', async () => {
  await page.keyboard.press('Control+ArrowRight');
  await page.waitForFunction(() => document.querySelector('.ch-num')?.textContent?.trim().endsWith('120'), null, { timeout: 30000 });
});
await open('Psalm 119', 176);

for (const panes of [2, 3]) {
  await time(`${panes} panes over Psalm 119`, async () => {
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill('parallel');
    await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.leaf[data-pane]').length === n, panes, { timeout: 60000 });
  });
}

await time('scroll a 3-pane Psalm 119 to the end', async () => {
  await page.locator('.leaf[data-pane="0"] .leaf-scroll').evaluate((n) => { n.scrollTop = n.scrollHeight; });
  await page.waitForTimeout(300);
});

const searchPane = () => page.locator('.search-pane');
const finished = () => page.waitForFunction(
  () => Boolean(document.querySelector('.search-pane .sr-time')),
  null,
  { timeout: 180000 },
);

await time('open the search pane', async () => {
  await page.locator('.leaf[data-pane="0"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+f');
  await searchPane().waitFor();
});

await time('search one translation for a common word', async () => {
  // Whichever translation was last read is the one searched by default, so the
  // word looked for is one every fixture carries.
  await page.locator('.search-pane > .field input').first().fill('1:1');
  await finished();
  return (await page.locator('.search-pane .sr-count').innerText()).replace(/\n/g, ' ');
});

await time('the same search as a regular expression', async () => {
  // The modes are adornments in the search box now: switches, not a segment.
  await page.locator('.sm-btn[data-flag="regex"]').click();
  await page.locator('.search-pane > .field input').first().fill('1:[12]');
  await finished();
  return (await page.locator('.search-pane .sr-count').innerText()).replace(/\n/g, ' ');
});

// The expensive one: every verse of every held translation, read from storage.
await time('search every held translation', async () => {
  await page.locator('.sm-btn[data-flag="regex"]').click();
  await page.locator('.sf-toggle').click();
  // The chooser is a list of translations to add, not a set of tick boxes:
  // click each row until the list has nothing left to add.
  const field = page.locator('.sf-list[data-name="translations"]').locator('xpath=preceding-sibling::div[1]').locator('input');
  await field.click();
  const rows = page.locator('.sf-list[data-name="translations"] .sf-row');
  for (let left = await rows.count(); left > 0; left = await rows.count()) {
    await rows.first().click();
    await page.waitForTimeout(150);
    await field.click();
  }
  await page.locator('.search-pane > .field input').first().fill('1:1');
  await finished();
  return (await page.locator('.search-pane .sr-count').innerText()).replace(/\n/g, ' ');
});

await time('narrow that to one book', async () => {
  await page.locator('.sf-chip', { hasText: 'Open book' }).click();
  await finished();
  return (await page.locator('.search-pane .sr-count').innerText()).replace(/\n/g, ' ');
});

await time('reload with everything open', async () => {
  await page.reload();
  await page.waitForSelector('.verse', { timeout: 60000 });
});

const usage = await page.evaluate(async () => {
  const { usage: bytes } = await navigator.storage.estimate();
  const heap = performance.memory ? performance.memory.usedJSHeapSize : null;
  return { bytes, heap };
});
console.log(`\nstored: ${(usage.bytes / 1048576).toFixed(1)} MB`
  + (usage.heap ? ` · heap: ${(usage.heap / 1048576).toFixed(1)} MB` : ''));
if (app.problems.length) console.log('problems:', app.problems);
await app.close();
