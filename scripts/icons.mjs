#!/usr/bin/env node
/**
 * Every icon the builds ship, drawn from one source: public/icons/icon.svg.
 *
 *   node scripts/icons.mjs            dry run: what would be written
 *   node scripts/icons.mjs --apply    write the PNGs and the source's fingerprint
 *   node scripts/icons.mjs --out DIR  write them under DIR instead, to look at
 *
 * The PNGs are committed rather than made during a build. A build that needs a
 * browser to make its icons needs one on every release runner, and two
 * Chromium versions do not draw the same pixels, so every build would hand
 * back "changed" icons nobody changed. Drawn here, when the SVG changes, they
 * change when it does and not otherwise.
 *
 * The SVG is drawn by the Chromium the browser tests already use (playwright-
 * core), so there is no image library to install. What the SVG was when the
 * icons were last drawn is kept as a SHA-256 in assets/icons/source.sha256;
 * test/icons.test.js fails when the SVG no longer matches it, which is how a
 * changed SVG with stale PNGs is caught.
 *
 * The maskable icon (Android's adaptive shapes crop it to a circle or a
 * squircle) is the icon at 60 % on the app's own background, so nothing that
 * matters falls outside the safe zone. The mark has no background of its own,
 * so the desktop icons are set in from the edge (`inset`), as a desktop's own
 * icons are.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'public/icons/icon.svg');
const STAMP = join(ROOT, 'assets/icons/source.sha256');
/** The manifest's background_color: what a maskable icon sits on. */
const BACKGROUND = '#181818';

/** @type {{ path: string, size: number, maskable?: boolean }[]} */
export const ICONS = Object.freeze([
  // electron-builder: macOS and Windows take one large image. The mark has no
  // background of its own, so it is set in from the edge the way a desktop's
  // own icons are; drawn edge to edge it would look a size larger than its
  // neighbours in a dock or a taskbar.
  { path: 'assets/icon.png', size: 1024, inset: 0.84 },
  // Linux: one per hicolor size (electron-builder.yml `linux.icon`).
  ...[16, 24, 32, 48, 64, 128, 256, 512].map((n) => ({ path: `assets/icons/${n}x${n}.png`, size: n, inset: n >= 48 ? 0.9 : 1 })),
  // The web build and its manifest.
  { path: 'public/icons/favicon-32.png', size: 32 },
  { path: 'public/icons/icon-192.png', size: 192 },
  { path: 'public/icons/icon-512.png', size: 512 },
  { path: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
]);

export const sourceHash = () => createHash('sha256').update(readFileSync(SOURCE)).digest('hex');

function chromium() {
  const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return path;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const dir of readdirSync(base)) {
      for (const inner of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome']) {
        if (existsSync(join(base, dir, inner))) return join(base, dir, inner);
      }
    }
  }
  return null;
}

async function draw(svg, { size, maskable, inset = 1 }) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  // A maskable icon is cut to a circle, a squircle or a rounded square by
  // the launcher; only the middle 80 % circle is sure to survive, and a
  // book wider than it is tall needs to sit well inside that.
  const inner = Math.round(size * (maskable ? 0.6 : inset));
  const html = `<!doctype html><html><body style="margin:0;background:${maskable ? BACKGROUND : 'transparent'}">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
      <img src="${src}" width="${inner}" height="${inner}" style="display:block"></div></body></html>`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html);
  await page.waitForFunction(() => document.images[0]?.complete && document.images[0].naturalWidth > 0);
  return page.screenshot({ type: 'png', omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
}

let page = null;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : null;
  if (outAt >= 0 && !out) throw new Error('icons: --out needs a folder');
  const unknown = args.filter((a, i) => a !== '--apply' && a !== '--out' && i !== outAt + 1);
  if (unknown.length) throw new Error(`icons: unknown argument ${unknown.join(' ')} (--apply, or --out DIR)`);
  if (apply && out) throw new Error('icons: --apply writes into the repository and --out somewhere else; choose one');
  if (!existsSync(SOURCE)) throw new Error(`icons: ${relative(ROOT, SOURCE)} is missing`);
  const executablePath = chromium();
  if (!executablePath) throw new Error('icons: no Chromium found — set CHROMIUM_PATH, or install one with playwright');
  let playwright;
  try {
    playwright = await import('playwright-core');
  } catch {
    throw new Error('icons: playwright-core is not installed (npm i -D playwright-core)');
  }

  const svg = readFileSync(SOURCE, 'utf8');
  const hash = sourceHash();
  const stamped = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : null;
  console.log(`source   ${relative(ROOT, SOURCE)}  sha256 ${hash.slice(0, 12)}…  ${stamped === hash ? '(icons drawn from this)' : '(icons are stale or were never stamped)'}`);

  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  try {
    page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const icon of ICONS) {
      const png = await draw(svg, icon);
      const target = out ? join(out, icon.path) : join(ROOT, icon.path);
      const state = existsSync(target) ? 'replace' : 'create ';
      console.log(`${apply || out ? 'wrote  ' : state} ${relative(out ? out : ROOT, target).padEnd(38)} ${String(icon.size).padStart(4)} px${icon.maskable ? '  maskable' : ''}  ${png.length} bytes`);
      if (out) mkdirSync(dirname(target), { recursive: true });
      if (apply || out) writeFileSync(target, png);
    }
  } finally {
    await browser.close();
  }
  if (apply) {
    writeFileSync(STAMP, `${hash}\n`);
    console.log(`\nstamped  ${relative(ROOT, STAMP)}`);
  } else if (!out) {
    console.log('\nDry run. Re-run with --apply to write.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
