/**
 * The crawl: every command in the palette, run from a known state, and the
 * screen inspected after each for what a reader would call broken — errors
 * logged, a page that scrolls sideways, a placeholder or a string key shown
 * as text, raw Strong's markup, a label cut through without an ellipsis, one
 * control on top of another, a popover off the screen, a button with no name.
 *
 *   node test/e2e/crawl.mjs <width> <height> <name> [locale] [light|dark]
 *   npm run test:crawl       desktop dark and light, Norwegian, phone in
 *                            English and in Burmese
 *
 * Screenshots of every place with a finding, and report.json, go to the
 * system's temporary folder under lai-crawl/<name>. Exit code 1 on any
 * finding. Slow (a few minutes a run), so not part of test:e2e.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { available, launch, installFromLibrary } from './harness.mjs';
const [W, H, NAME, LOC = 'en', SCHEME = 'dark'] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5], process.argv[6]];
const ready = await available();
if (!ready.ok) { console.log(`crawl skipped: ${ready.why}`); process.exit(0); }
const OUT = join(tmpdir(), 'lai-crawl', NAME);
mkdirSync(OUT, { recursive: true });
const phone = W < 800;
const app = await launch({ viewport: { width: W, height: H }, phone, locale: LOC, colorScheme: SCHEME });
const { page } = app;
page.on('dialog', (d) => d.dismiss().catch(() => {}));
page.on('filechooser', () => {});
const report = [];
const inspect = () => page.evaluate(() => {
  const out = [];
  const vis = (el) => { if (!el.isConnected || el.closest('details:not([open]) > :not(summary)')) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && el.closest('[hidden]') === null; };
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
  const text = document.body.innerText;
  const docText = text.replace(/\{identify\}\.json|iso-\{code\}\.json/g, '');
  for (const [re, what] of [[/\{[a-z][A-Za-z]*\}/g, 'unfilled placeholder'], [/\bundefined\b/g, '"undefined"'], [/\bNaN\b/g, '"NaN"'], [/\[object Object\]/g, '[object Object]'], [/\{[HG]\d+[A-Z]?\}/g, 'raw Strong\'s markup'], [/\b(?:lib|set|cmd|lbl|imp|guide|find|doc|msg|val|cd|exp|src|rp|tri|vx|pl|nm|pj|mem|cmp)\.[a-zA-Z][\w.]*[a-zA-Z]\b/g, 'string key shown']]) {
    const m = docText.match(re); if (m) out.push(`${what}: ${[...new Set(m)].slice(0, 4).join(', ')}`);
  }
  // Clipped text: a leaf with text, overflowing its box, not ellipsised.
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length || !el.textContent.trim() || !vis(el)) continue;
    const s = getComputedStyle(el);
    if (el.closest('.chapter, .cd-stage, textarea, .source, .modal-list, .scroll')) { /* content areas scroll */ }
    const clipX = el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.clientWidth > 0;
    const clipY = el.scrollHeight > el.clientHeight + 3 && /hidden|clip/.test(s.overflowY) && !/-webkit-box/.test(s.display) && el.clientHeight > 0 && s.webkitLineClamp === 'none';
    if (clipX || clipY) out.push(`clipped ${clipX ? 'sideways' : 'at the foot'}: <${el.tagName.toLowerCase()} class="${el.className}"> "${el.textContent.trim().slice(0, 40)}"`);
  }
  // Overlapping controls.
  const ctrls = [...document.querySelectorAll('button, input, select, textarea, a[href], [role="tab"]')].filter(vis)
    .filter((el) => !el.closest('.chapter, .cd-canvas, .toast, .drag-ghost'));
  // What of an element is actually on screen: its box cut by every ancestor
  // that clips, so a control scrolled out of its pane is not "under" the next.
  const shown = (el) => {
    let r = el.getBoundingClientRect(); r = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/hidden|clip|auto|scroll/.test(s.overflowX + s.overflowY)) {
        const q = p.getBoundingClientRect();
        r = { left: Math.max(r.left, q.left), top: Math.max(r.top, q.top), right: Math.min(r.right, q.right), bottom: Math.min(r.bottom, q.bottom) };
      }
    }
    return r;
  };
  const drawer = document.body.classList.contains('has-drawer');
  // The phone's controls float over a page that scrolls under them.
  const layer = (el) => el.closest('.composer, .float-win, .popover, .modal, .menu, .cd-panel, .rpanel, .toast, .mobile-bar, .ph-tabs, .ph-nav, .ph-sheet')
    ?? (drawer ? el.closest('.sidebar') : null);
  const boxes = ctrls.map((el) => ({ el, r: shown(el), layer: layer(el) })).filter((b) => b.r.right - b.r.left > 1 && b.r.bottom - b.r.top > 1);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // A floating window over the page is by design; inside it, it is judged on its own.
      if (a.layer !== b.layer) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > 3 && iy > 3) {
        // Only when one is actually on top of the other where they meet.
        const x = Math.max(a.r.left, b.r.left) + ix / 2; const y = Math.max(a.r.top, b.r.top) + iy / 2;
        const top = document.elementFromPoint(x, y);
        const covered = top && !(a.el.contains(top) && b.el.contains(top));
        if (covered) out.push(`overlap: ${a.el.tagName.toLowerCase()}.${String(a.el.className).split(' ')[0]} "${(a.el.innerText || a.el.title || a.el.placeholder || '').trim().slice(0, 20)}" × ${b.el.tagName.toLowerCase()}.${String(b.el.className).split(' ')[0]} "${(b.el.innerText || b.el.title || b.el.placeholder || '').trim().slice(0, 20)}"`);
      }
    }
  }
  // Floating things off screen.
  for (const el of document.querySelectorAll('.popover, .modal, .menu, .cd-panel, .rpanel, .toast')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`off screen: .${String(el.className).split(' ').join('.')} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // Buttons with no name.
  for (const el of ctrls) {
    if (el.tagName === 'BUTTON' && !(el.innerText.trim() || el.getAttribute('aria-label') || el.title)) out.push(`unnamed button: .${String(el.className).split(' ')[0]} in .${String(el.parentElement?.className).split(' ')[0]} html=${el.outerHTML.slice(0, 120)}`);
  }
  return [...new Set(out)];
});
const reset = async () => {
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); }
  // By position, not by name: the name is in whatever language is on.
  for (const close of await page.locator('.composer:not([hidden]) .cw-tool').all()) {
    if ((await close.innerHTML()).includes('#i-x')) await close.click({ timeout: 2000 }).catch(() => {});
  }
  // A phone's active tab opens the tab switcher when pressed; go by palette there.
  const tab = page.locator('.tabstrip .tab[data-kind="chapter"]').first();
  const onChapter = await page.locator('.chapter').first().isVisible().catch(() => false);
  if (!phone && await tab.count() && await tab.isVisible()) await tab.click().catch(() => {});
  else if (!onChapter) {
    await page.keyboard.press('Control+p'); await page.locator('.modal-input').fill('gen 1'); await page.waitForTimeout(250); await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(300);
};
try {
  await app.open();
  await page.waitForSelector('.wl', { timeout: 20000 });
  report.push({ at: 'welcome', found: await inspect() });
  await page.locator('.wl .btn.primary').click();
  await page.waitForTimeout(600);
  report.push({ at: 'library, first run', found: await inspect() });
  await installFromLibrary(page, 'kjv1611');
  await installFromLibrary(page, 'ddb1931');
  await reset();
  report.push({ at: 'chapter', found: await inspect() });
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(400);
  const titles = await page.locator('.modal-list .mi-t').allInnerTexts();
  const ids = await page.locator('.modal-list .mi').evaluateAll((rows) => rows.map((r) => r.dataset.id ?? ''));
  await page.keyboard.press('Escape');
  // Toggles by their place in the palette's full list (the same in every
  // language): pressed again to put things back.
  const TOGGLE = /^(shell\.(left|right|ribbon|statusbar|theme)|reading\.(mode|strongs|headings|xrefs|sync)|ink\.|pane\.)/;
  const toggles = new Set();
  ids.forEach((id, i) => { if (TOGGLE.test(id)) toggles.add(i); });
  const SKIP_IDS = /^(tab\.close|app\.install|settings\.import|projects\.import|library\.import|tab\.detach)$/;
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const skip = /^(Close|Install on this device|Import settings|Import a project…|Add your own|Detach)$/;
  for (const title of titles) {
    if (skip.test(title) || SKIP_IDS.test(ids[titles.indexOf(title)]) || (only && !only.test(title))) continue;
    await reset();
    const before = app.problems.length;
    await page.keyboard.press('Control+p');
    await page.locator('.modal-input').fill(title);
    await page.waitForTimeout(250);
    const idx = (await page.locator('.modal-list .mi-t').allInnerTexts()).indexOf(title);
    if (idx < 0) {
      const items = await page.locator('.modal-list .mi-t').allInnerTexts();
      const typed = await page.locator('.modal-input').inputValue().catch(() => '(no input)');
      await page.screenshot({ path: `${OUT}/notfound-${title.replace(/[^\w]+/g, '_')}.png` });
      report.push({ at: title, found: [`not found in the palette by its own name (typed "${typed}", listed ${JSON.stringify(items.slice(0, 5))})`] });
      await page.keyboard.press('Escape'); continue;
    }
    for (let i = 0; i < idx; i += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const found = await inspect();
    const errs = app.problems.slice(before);
    if (errs.length) found.push(...errs.map((e) => `logged: ${String(e).slice(0, 160)}`));
    if (found.length) await page.screenshot({ path: `${OUT}/${title.replace(/[^\w]+/g, '_')}.png` });
    report.push({ at: title, found });
    // Toggles go back to where they were.
    if (toggles.has(titles.indexOf(title))) {
      await reset();
      await page.keyboard.press('Control+p');
      // The same command again, by its id: a pane's command changes its name
      // from Hide to Show once pressed.
      await page.locator('.modal-input').fill('');
      await page.waitForTimeout(250);
      const again = page.locator(`.modal-list .mi[data-id="${ids[titles.indexOf(title)]}"]`);
      if (await again.count()) await again.first().click(); else await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }
} catch (err) {
  report.push({ at: 'crawler', found: [`stopped: ${err.message.split('\n')[0]}`] });
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  const bad = report.filter((r) => r.found.length);
  console.log(`${NAME}: ${report.length} places, ${bad.length} with findings${bad.length ? ` — ${OUT}` : ''}`);
  for (const place of bad) console.log(`  ${place.at}\n    ${place.found.join('\n    ')}`);
  await app.close();
  process.exitCode = bad.length ? 1 : 0;
}
