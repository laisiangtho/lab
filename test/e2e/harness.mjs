/**
 * End-to-end harness: the built web app, a static server for it, and a browser.
 *
 * The suite drives the real build — `dist/web` — rather than a test double, so
 * what it proves is what a reader gets. Everything the app would fetch from the
 * catalog repository is answered from fixtures generated here, so the tests are
 * deterministic, offline, and small enough to live in the repository.
 *
 * The browser driver is the one dependency the unit tests do not need, so it is
 * optional: `available()` reports why the suite cannot run instead of failing,
 * and the caller skips. Install it with:
 *
 *   npm i -D playwright-core   (and a Chromium build, or set CHROMIUM_PATH)
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = join(ROOT, 'dist', 'web');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/** @returns {Promise<{ ok: true } | { ok: false, why: string }>} */
export async function available() {
  if (!existsSync(join(DIST, 'index.html'))) return { ok: false, why: 'dist/web is not built — run `npm run build` first' };
  try {
    await import('playwright-core');
  } catch {
    return { ok: false, why: 'playwright-core is not installed (npm i -D playwright-core)' };
  }
  if (!chromiumPath()) return { ok: false, why: 'no Chromium found — set CHROMIUM_PATH' };
  return { ok: true };
}

function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return path;
  // Playwright's own download location, whatever its build number.
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const dir of readdirSync(base)) {
      for (const inner of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome']) {
        const path = join(base, dir, inner);
        if (existsSync(path)) return path;
      }
    }
  }
  return '';
}

/** Serve the built app; returns its origin and a way to stop it. */
export async function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = join(DIST, path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
    if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async stop() { await new Promise((done) => server.close(done)); },
  };
}

/**
 * A browser with the catalog repository answered from fixtures.
 * @param {{ viewport?: {width:number,height:number}, phone?: boolean, fixtures?: object }} options
 */
export async function launch(options = {}) {
  const { chromium } = await import('playwright-core');
  const data = options.fixtures ?? fixtures();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: options.headed ? false : undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    colorScheme: 'dark',
    // A phone: touch, no hover, and the pixel density that makes a 1 px
    // hairline and a 40 px margin look the way they do on one.
    ...(options.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
  });

  const requests = [];
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const url = route.request().url();
    requests.push(url);
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const body = data.forUrl(url);
    if (body === null) return route.fulfill({ status: 404, headers, body: '{}' });
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });

  const page = await context.newPage();
  const problems = [];
  const missing = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // A failed request is reported by the browser itself as a console error with
  // no detail in it. The response is the useful record, so it is kept apart and
  // the console line dropped — otherwise every deliberately absent fixture
  // (a language pack no repository carries) reads as an application fault.
  page.on('response', (r) => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });

  return {
    page,
    requests,
    problems,
    missing,
    origin: server.origin,
    async open() {
      await page.goto(server.origin);
      await page.waitForSelector('#app .body-row');
      return page;
    },
    async close() {
      await browser.close();
      await server.stop();
    },
  };
}

/**
 * Catalog, translations and language packs, built from the real category.json
 * so book ids, chapter counts and verse counts are the app's own.
 *
 * Four books are enough for behaviour and keep the suite quick. Pass
 * `books: 'all'` for the whole canon — 31,102 verses a translation, which is
 * what the measurements in `test/e2e/perf.mjs` are for.
 *
 * @param {{ books?: number[] | 'all' }} [options]
 */
export function fixtures({ books: only = [1, 2, 19, 40] } = {}) {
  const category = JSON.parse(readFileSync(join(ROOT, 'public', 'category.json'), 'utf8'));
  const books = category.book.map((b) => ({ id: b.id, chapters: b.clue.c, verses: b.clue.v, name: b.info.name }));
  const pick = () => (only === 'all' ? books : books.filter((b) => only.includes(b.id)));

  const translations = {
    kjv1611: build('kjv1611', 'King James Version', 'KJV', 'English', { name: 'eng', iso: { '639-1': 'en', '639-3': 'eng' } }, pick(), (b, c, v) => pad(`${b.name} ${c}:${v} in English.`, 'and the word of the reading went out over the whole of the land')),
    judson1835: build('judson1835', 'သမ္မာကျမ်း', 'ယုဒသန်', 'Myanmar', { name: 'mya', iso: { '639-1': 'my', '639-3': 'mya' } }, pick(), (b, c, v) => pad(`မြန်မာ ${c}:${v} စာသား။`, 'ထိုအခါ စကားတော်သည် တပြည်လုံးသို့ ရောက်လေ၏။'), {
      testament: { 1: { info: { name: 'ဓမ္မဟောင်းကျမ်း', shortname: 'OT' } }, 2: { info: { name: 'ဓမ္မသစ်ကျမ်း', shortname: 'NT' } } },
      bookNames: { 1: 'ကမ္ဘာဦးကျမ်း', 2: 'ထွက်မြောက်ရာကျမ်း', 19: 'ဆာလံကျမ်း', 40: 'မဿဲ' },
      digit: ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉'],
    }),
    // No 639-1, which is the ordinary state of a real translation file: the
    // field exists in the schema and nobody filled it in.
    // One verse carries a Strong's number, the way an import from a tagged
    // edition leaves them: the reading surface has to turn `{H7225}` into a
    // word somebody can press, and nothing else in the fixtures exercises that.
    ddb1931: build('ddb1931', 'Det Danske Bibel', 'Danske', 'Danish', { name: 'dan', iso: { '639-1': '', '639-3': 'dan' } }, pick(), (b, c, v) => pad(`Dansk ${c}:${v} tekst${v === 1 ? '{H7225}' : ''}.`, 'og ordet gik ud over hele landet og blev hørt af alle'), {
      bookNames: { 1: 'Første Mosebog', 2: 'Anden Mosebog', 19: 'Salmernes Bog', 40: 'Matthæus' },
      described: { 19: 'Salmerne, samlet gennem mange århundreder.' },
      rich: true,
      story: { 19: { 23: { 1: { text: 'Herren er min hyrde', ref: 'Sal.23.1' } } } },
    }),
  };

  const catalog = {
    name: 'test catalog',
    updated: '2026-09-01',
    version: 1,
    book: Object.values(translations).map((t) => ({
      identify: t.identify,
      name: t.info.name,
      shortname: t.info.shortname,
      year: t.info.year,
      language: { text: t.info.language.text, textdirection: 'ltr', name: t.info.language.iso['639-1'] || t.info.language.iso['639-3'] },
      version: String(t.version),
      publisher: t.info.publisher,
    })),
  };

  const packs = {
    mya: pack('mya', { 1: 'ဓမ္မဟောင်းကျမ်း', 2: 'ဓမ္မသစ်ကျမ်း' }, { 1: 'ကမ္ဘာဦးကျမ်း' }, ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']),
    dan: pack('dan', { 1: 'Det Gamle Testamente', 2: 'Det Nye Testamente' }, { 1: 'Første Mosebog' }, []),
  };

  return {
    catalog,
    translations,
    packs,
    /** What the app would get from the catalog repository for this URL. */
    forUrl(url) {
      if (url.endsWith('/book.json')) return catalog;
      const pack = url.match(/lang\/iso-([a-z]{3})\.json$/);
      if (pack) return packs[pack[1]] ?? null;
      const file = url.match(/json\/([^/]+)\.json$/);
      return file ? translations[file[1]] ?? null : null;
    },
  };

  /** Verses the length real ones are, so sizes and timings mean something. */
  function pad(head, tail) {
    let text = head;
    while (text.length < 110) text += ` ${tail}`;
    return `${text.slice(0, 118).trimEnd()}.`;
  }

  function build(identify, name, shortname, language, iso, list, text, extra = {}) {
    const book = {};
    for (const b of list) {
      const chapter = {};
      for (let c = 1; c <= b.chapters; c += 1) {
        const verse = {};
        for (let v = 1; v <= b.verses[c - 1]; v += 1) {
          verse[v] = { text: text(b, c, v) };
          // A cross-reference on the first verse of every chapter. Real files
          // carry these and the reading surface renders them as links, so a
          // fixture without any cannot exercise how a reference is followed.
          if (v === 1 && b.id !== 19) verse[v].ref = 'Ps 23:1';
        }
        chapter[c] = { verse };
      }
      book[b.id] = { info: { name: extra.bookNames?.[b.id] ?? b.name, shortname: (extra.bookNames?.[b.id] ?? b.name).slice(0, 3), abbr: [] }, chapter };
      if (extra.described?.[b.id]) book[b.id].info.desc = extra.described[b.id];
    }
    // A published edition is not a grid of verses: it merges some, heads some
    // with a pericope title, and describes some of its books. Nothing else in
    // the fixtures carries any of that, so the code that counts and lists it
    // was only ever exercised against zero.
    if (extra.rich) {
      const psalm = book[19]?.chapter?.[23]?.verse;
      if (psalm) {
        // One verse covering two, the covered one absent — which is what makes
        // the chapter still agree with the canon.
        psalm[3] = { ...psalm[3], merge: '4' };
        delete psalm[4];
        psalm[1] = { ...psalm[1], title: 'Hyrden' };
      }
      const exodus = book[2]?.chapter?.[3]?.verse;
      if (exodus) exodus[2] = { ...exodus[2], title: 'Den brændende busk' };
    }
    return {
      identify,
      version: 1,
      info: {
        identify, name, shortname, year: '1900', version: 1,
        language: { text: language, textdirection: 'ltr', ...iso },
        description: `${name}, a fixture.`,
        publisher: 'Test Bible Society',
        copyright: 'Public domain.',
      },
      ...(extra.digit ? { digit: extra.digit } : {}),
      ...(extra.testament ? { testament: extra.testament } : {}),
      ...(extra.story ? { story: extra.story } : {}),
      book,
    };
  }

  function pack(code, testaments, bookNames, digit) {
    return {
      ...(digit.length ? { digit } : {}),
      testament: Object.fromEntries(Object.entries(testaments).map(([id, nm]) => [id, { info: { name: nm, shortname: nm.slice(0, 2) } }])),
      book: Object.fromEntries(Object.entries(bookNames).map(([id, nm]) => [id, { info: { name: nm, shortname: nm.slice(0, 3), abbr: [] } }])),
      section: {},
      locale: { book: 'book', code },
    };
  }
}
