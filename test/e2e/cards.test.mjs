/**
 * The card studio's panels, at the size a reader actually uses and on a
 * phone: every row a label with its control close under or beside it, no row
 * wider than its panel, and the panel on screen and clear of the floating bar.
 *
 * A column-direction row once gave its label a 200 px *height* (a flex-basis
 * meant as a width), which left each label far above its control in every
 * panel. Nothing looked at the panels at the size they are used at.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, installFromLibrary, launch } from './harness.mjs';

const ready = await available();
const options = ready.ok ? {} : { skip: `end-to-end: ${ready.why}` };

const SIZES = [
  { name: 'a desktop window, light', viewport: { width: 1742, height: 1262 }, colorScheme: 'light' },
  { name: 'a phone, in Burmese', viewport: { width: 390, height: 844 }, phone: true, locale: 'my' },
];

for (const size of SIZES) {
  test(`the card studio's panels, on ${size.name}`, options, async (t) => {
    const app = await launch(size);
    const { page } = app;
    t.after(() => app.close());
    await app.open();
    await page.waitForSelector('.wl', { timeout: 20000 });
    await page.locator('.wl .btn.primary').click();
    await installFromLibrary(page, 'ddb1931');
    await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
    await page.waitForSelector('.verse');
    await page.evaluate(() => window.__lai?.openDoc?.('cards'));
    if (!(await page.locator('.cd-canvas').count())) {
      await page.keyboard.press('Control+p');
      await page.locator('.modal-input').fill(size.locale === 'my' ? 'ကတ်များ' : 'Cards');
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.cd-canvas');
    await page.waitForTimeout(500);

    const panels = await page.$$eval('.cd-tool[data-panel]', (els) => els.map((e) => e.dataset.panel));
    assert.ok(panels.length >= 6, `the studio has its panels (${panels})`);
    for (const which of panels) {
      await t.test(which, async () => {
        const tool = page.locator(`.cd-tool[data-panel="${which}"]`);
        if (await tool.isVisible()) await tool.click();
        else {
          await page.locator('.cd-more').click();
          await page.locator('.popover.menu .menu-item').nth(panels.indexOf(which)).click();
        }
        await page.waitForSelector('.cd-panel:not([hidden])');
        await page.waitForTimeout(250);
        const found = await page.evaluate(() => {
          const out = [];
          for (const row of document.querySelectorAll('.cd-panel .set-row')) {
            const kids = [...row.children].filter((k) => k.offsetParent);
            // What is drawn, not the boxes: a label's box was the stretched part,
            // so a label is measured by the words inside it.
            const drawn = (k) => {
              if (!k.classList.contains('set-text')) return k.getBoundingClientRect().height;
              const parts = [...k.children].filter((c) => c.offsetParent);
              if (!parts.length) return k.getBoundingClientRect().height;
              return parts[parts.length - 1].getBoundingClientRect().bottom - parts[0].getBoundingClientRect().top;
            };
            const content = kids.reduce((n, k) => n + drawn(k), 0);
            const height = row.getBoundingClientRect().height;
            const name = row.innerText.split('\n')[0];
            // Padding and the gaps between the parts, and no more.
            if (height > content + (kids.length - 1) * 12 + 24) out.push(`"${name}" is ${Math.round(height)}px for ${Math.round(content)}px of content`);
            if (row.scrollWidth > row.clientWidth + 1) out.push(`"${name}" is wider than its panel`);
          }
          const box = document.querySelector('.cd-panel').getBoundingClientRect();
          if (box.left < 0 || box.right > innerWidth || box.bottom > innerHeight) out.push('the panel runs off the screen');
          const pill = document.querySelector('.mobile-bar');
          if (pill?.offsetParent && box.bottom > pill.getBoundingClientRect().top) out.push('the panel runs under the floating bar');
          return out;
        });
        assert.deepEqual(found, []);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      });
    }
    await t.test('nothing was logged', () => assert.deepEqual(app.problems, []));
  });
}
