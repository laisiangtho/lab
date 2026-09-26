/**
 * Desktop smoke test: does the packaged application actually start?
 *
 * Runs the built Electron app with a debugging port open, attaches to the
 * window it puts up, and checks that the shell rendered and nothing was logged
 * as an error. It proves the parts the web suite cannot reach — the custom
 * protocol the renderer is served over, the preload bridge, and the content
 * policy that would otherwise block the app's own scripts.
 *
 *   npm run desktop:build && node test/e2e/desktop.mjs
 *
 * Needs a display. On a machine without one, run it under xvfb-run.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = 9333;

const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
if (!existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
  console.error('skipped: out/ is not built — run `npm run desktop:build` first');
  process.exit(0);
}
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('skipped: playwright-core is not installed');
  process.exit(0);
}

const child = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, '--no-sandbox'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});
const output = [];
child.stdout.on('data', (d) => output.push(String(d)));
child.stderr.on('data', (d) => output.push(String(d)));

let failed = null;
try {
  const browser = await attach();
  const [context] = browser.contexts();
  const page = context.pages().find((p) => !p.url().startsWith('devtools:')) ?? (await context.waitForEvent('page'));
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });

  await page.waitForSelector('#app .body-row', { timeout: 30000 });
  // Whichever the stored state leads to: the greeting on a first run, the
  // library once it has been read, the text on any later one.
  await page.waitForSelector('.wl, .library-item, .verse', { timeout: 30000 });
  if (await page.locator('.wl-acts .btn.primary').count()) {
    await page.locator('.wl-acts .btn.primary').click();
    await page.waitForSelector('.library-item, .verse', { timeout: 30000 });
  }
  const info = await page.evaluate(() => window.lai?.appInfo());
  check('the shell rendered', await page.locator('.ribbon').count() === 1);
  check('it has something to show', await page.locator('.library-item, .verse').count() > 0);
  check('the preload bridge answers', Boolean(info?.version));
  check('nothing was logged', problems.length === 0, problems.join(' / '));
  console.log(`  ${info.name} ${info.version} · ${info.runtime} · ${info.platform}`);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await browser.close();
} catch (err) {
  failed = err;
} finally {
  child.kill('SIGTERM');
}

if (failed) {
  console.error(`\nFAILED: ${failed.message}`);
  if (output.length) console.error(output.join('').trim().split('\n').slice(-12).join('\n'));
  process.exit(1);
}

function check(what, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(what);
}

/** The debugging port opens a moment after the process does. */
async function attach() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch (err) {
      if (Date.now() > deadline) throw new Error(`could not attach to the app (${err.message})`);
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}
