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
import { parseCategory } from '../../app/core/category.js';
import { contentOf } from '../../app/core/content.js';
import { parseTranslation } from '../../app/core/translation.js';

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
 * @param {{ viewport?: {width:number,height:number}, phone?: boolean, locale?: string, fixtures?: object, permissions?: string[] }} options
 */
export async function launch(options = {}) {
  const { chromium } = await import('playwright-core');
  const data = options.fixtures ?? fixtures();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: options.headed ? false : undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    colorScheme: options.colorScheme ?? 'dark',
    // A phone: touch, no hover, and the pixel density that makes a 1 px
    // hairline and a 40 px margin look the way they do on one.
    ...(options.phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}),
    // The device's language, as navigator.languages reports it.
    ...(options.locale ? { locale: options.locale } : {}),
    // What the page may do without asking: reading the clipboard back, say.
    ...(options.permissions ? { permissions: options.permissions } : {}),
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

  // GitHub's list of the catalog repository's files, which the guide reads to
  // find its downloadable answers. Answered from the fixtures, like the rest.
  await context.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    requests.push(url);
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    const body = data.forUrl(url);
    if (body === null) return route.fulfill({ status: 404, headers, body: '{}' });
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });

  // The Library's other sources, getBible and eBible.org, and the study data
  // publishers (OpenBible.info, CCEL), answered from the fixtures too: a test
  // never reaches the real sites.
  await context.route(/^https:\/\/(api\.getbible\.net|ebible\.org|a\.openbible\.info|ccel\.org)\//, async (route) => {
    const url = route.request().url();
    requests.push(url);
    const found = await data.sourceFile(url);
    if (!found) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': found.type }, body: found.body });
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
    /**
     * The app, started. A device whose language is one the app fetches
     * (Burmese) is offered it once the app is up; the offer is taken, the
     * way a reader takes it, so the page that comes back is in that language.
     */
    async open() {
      await page.goto(server.origin);
      await page.waitForSelector('#app .body-row');
      const wanted = String(options.locale ?? '').toLowerCase().split('-')[0];
      if (wanted && existsSync(join(ROOT, 'locale', `${wanted}.json`))
        && await page.evaluate(() => document.documentElement.lang) !== wanted) {
        const reload = page.waitForEvent('load');
        await page.locator('.toast .toast-act').first().click();
        await reload;
        await page.waitForSelector('#app .body-row');
        await page.waitForFunction((code) => document.documentElement.lang === code, wanted);
      }
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
    // Three verses carry numbers, the way an import from a tagged edition
    // leaves them: a Strong's number to press (1), the edition's own number
    // past the end of the lexicon, which eBible.org's tagged Judson uses for
    // words with nothing behind them (2), and a sense letter (3).
    ddb1931: build('ddb1931', 'Det Danske Bibel', 'Danske', 'Danish', { name: 'dan', iso: { '639-1': '', '639-3': 'dan' } }, pick(), (b, c, v) => pad(`Dansk ${c}:${v} tekst${{ 1: '{H7225}', 2: '{H9999}', 3: '{H1254a}' }[v] ?? ''}.`, 'og ordet gik ud over hele landet og blev hørt af alle'), {
      bookNames: { 1: 'Første Mosebog', 2: 'Anden Mosebog', 19: 'Salmernes Bog', 40: 'Matthæus' },
      described: { 19: 'Salmerne, samlet gennem mange århundreder.' },
      rich: true,
      story: { 19: { 23: { 1: { text: 'Herren er min hyrde', ref: 'Sal.23.1' } } } },
    }),
  };

  const canon = parseCategory(category);
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
      // What it carries, counted the way scripts/catalog-content.mjs counts it.
      content: contentOf(parseTranslation(t, { identify: t.identify, category: canon }), canon),
    })),
  };

  const packs = {
    mya: pack('mya', { 1: 'ဓမ္မဟောင်းကျမ်း', 2: 'ဓမ္မသစ်ကျမ်း' }, { 1: 'ကမ္ဘာဦးကျမ်း' }, ['၀', '၁', '၂', '၃', '၄', '၅', '၆', '၇', '၈', '၉']),
    dan: pack('dan', { 1: 'Det Gamle Testamente', 2: 'Det Nye Testamente' }, { 1: 'Første Mosebog' }, []),
  };

  /** Downloadable guide answers, as the catalog repository will hold them. */
  const faq = (name, questions) => ({
    '@context': 'https://schema.org', '@type': 'FAQPage', name, inLanguage: 'en',
    mainEntity: questions.map(([q, a, target]) => ({
      '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a },
      ...(target ? { potentialAction: { '@type': 'Action', target } } : {}),
    })),
  });
  const guide = {
    'guide/README.md': null,
    'guide/en/books/19-psalms.json': faq('Psalms', [
      ['Who wrote Psalms?', 'Many writers; about half are headed "of David".', 'laisiangtho:passage/19/23'],
      ['What is Psalms about?', 'Israel\'s book of prayer and song.', 'laisiangtho:passage/19/1'],
    ]),
    'guide/en/help/search.json': faq('Search', [['How do I search only one testament?', 'Choose where in the scope under the field.', 'laisiangtho:command/search.open']]),
  };

  return {
    catalog,
    translations,
    packs,
    /** What the app would get from the catalog repository for this URL. */
    /** getBible's list and file, eBible.org's list and zip. */
    async sourceFile(url) {
      const genesis = Array.from({ length: 31 }, (_, i) => ({ chapter: 1, verse: i + 1, text: `World English ${i + 1}: in the beginning God made the heavens and the earth.` }));
      if (url === 'https://api.getbible.net/v2/translations.json') {
        return { type: 'application/json', body: JSON.stringify({
          web: { translation: 'World English Bible', abbreviation: 'web', lang: 'en', language: 'English', direction: 'LTR', distribution_license: 'Public Domain', url: 'https://api.getbible.net/v2/web.json' },
          kjv: { translation: 'King James Version', abbreviation: 'kjv', lang: 'en', language: 'English', direction: 'LTR', distribution_license: 'Public Domain', url: 'https://api.getbible.net/v2/kjv.json' },
        }) };
      }
      if (url === 'https://api.getbible.net/v2/web.json') {
        return { type: 'application/json', body: JSON.stringify({
          translation: 'World English Bible', abbreviation: 'web', lang: 'en', language: 'English', direction: 'LTR',
          books: [{ nr: 1, name: 'Genesis', chapters: [{ chapter: 1, name: 'Genesis 1', verses: genesis }] }],
        }) };
      }
      if (url === 'https://ebible.org/Scriptures/translations.csv') {
        return { type: 'text/csv', body: [
          'languageCode,translationId,languageName,languageNameInEnglish,title,shortTitle,Redistributable,Copyright,UpdateDate,textDirection,downloadable',
          'heb,hebwlc,עברית,Hebrew,Westminster Leningrad Codex,WLC,True,Public Domain,2023-05-01,rtl,True',
        ].join('\n') };
      }
      if (url === 'https://ebible.org/Scriptures/hebwlc_usfx.zip') {
        const { makeZip } = await import('../../app/services/zip.js');
        const verses = Array.from({ length: 31 }, (_, i) => `<v id="${i + 1}"/>בְּרֵאשִׁית ${i + 1}<ve/>`).join('');
        const blob = makeZip([
          { name: 'hebwlc_usfx.xml', text: `<usfx><book id="GEN"><c id="1"/>${verses}</book></usfx>` },
          { name: 'hebwlcmetadata.xml', text: '<DBLMetadata><identification><name>Westminster Leningrad Codex</name><abbreviation>WLC</abbreviation></identification><language><iso>heb</iso><name>Hebrew</name><scriptDirection>RTL</scriptDirection></language></DBLMetadata>' },
        ]);
        return { type: 'application/zip', body: Buffer.from(await blob.arrayBuffer()) };
      }
      // Study data: OpenBible.info's zip of one text file, CCEL's ThML.
      const study = (name) => readFileSync(join(ROOT, 'test', 'fixtures', 'studydata', name), 'utf8');
      if (url === 'https://a.openbible.info/data/cross-references.zip') {
        const { makeZip } = await import('../../app/services/zip.js');
        const blob = makeZip([{ name: 'cross_references.txt', text: study('openbible-gen1-1-5.txt') }]);
        return { type: 'application/zip', body: Buffer.from(await blob.arrayBuffer()) };
      }
      if (url === 'https://ccel.org/ccel/e/easton/ebd2.xml') return { type: 'text/xml', body: study('easton-a-extract.xml') };
      if (url === 'https://ccel.org/ccel/n/nave/bible.xml') return { type: 'text/xml', body: study('topics-thml.xml') };
      return null;
    },
    forUrl(url) {
      if (url.includes('api.github.com/') && url.includes('/git/trees/')) {
        return { truncated: false, tree: Object.keys(guide).map((path) => ({ path, type: 'blob', sha: `sha-${path}`, size: 100 })) };
      }
      const guideFile = url.match(/\/master\/(guide\/.+)$/);
      if (guideFile) return guide[decodeURIComponent(guideFile[1])] ?? null;
      if (url.endsWith('/book.json')) return catalog;
      // The interface languages the app fetches: this repository's own files.
      const locale = url.match(/\/master\/locale\/([\w-]+)\.json$/);
      if (locale) {
        const file = join(ROOT, 'locale', `${locale[1]}.json`);
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
      }
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

/**
 * Make a catalog translation available offline from the Library, wherever it
 * is open. Once something is on the device the Library opens on its home,
 * which lists only what is here; a translation still to get is under Get
 * more, in the catalog.
 */
export async function installFromLibrary(page, identify, { timeout = 60000 } = {}) {
  // The page draws after reading the store; asking before it has would find
  // neither the row nor the tabs.
  await page.waitForSelector('.lib-tab[aria-selected="true"]');
  await page.waitForTimeout(150);
  const row = page.locator(`.library-item[data-identify="${identify}"]`);
  if (!(await row.count())) {
    await page.locator('.lib-tab[data-page="more"]').click();
    await page.locator('.lib-src[data-source="catalog"]').click();
    await row.first().waitFor();
  }
  // Messages from an install before stay while the pointer is on them, and
  // on a phone the last one sits over this row's button; they are not what
  // this is for, so they are closed first.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((el) => el.remove()));
  // By what it does rather than what it says, so a run in Burmese finds it too.
  const button = page.locator(`[data-identify="${identify}"] button[data-place="install:${identify}"]`);
  if (await button.count()) await button.click();
  await page.locator(`[data-identify="${identify}"] .badge-ok`).first().waitFor({ timeout });
}

/**
 * Bring the reading to the front: the chapter's tab on a desktop, the Read
 * tab on a phone, which has no tab strip.
 */
/**
 * Both sidebars open, pressed open the way a reader opens them. A new reader
 * starts with neither; the Books side comes out with the first translation,
 * and the study side when a pane in it is asked for. A test about the
 * sidebars themselves asks for both.
 */
export async function openSidebars(page) {
  for (const [side, index] of [['left', 0], ['right', 1]]) {
    if (await page.evaluate((name) => document.body.dataset[name], side) === 'open') continue;
    await page.locator('.win-ctl button').nth(index).click();
    await page.waitForFunction((name) => document.body.dataset[name] === 'open', side);
  }
}

export async function toReading(page) {
  const phone = page.locator('.ph-tab[data-tab="read"]');
  if (await phone.isVisible()) await phone.click();
  else await page.locator('.tabstrip .tab[data-kind="chapter"]').first().click();
}
