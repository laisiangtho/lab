/**
 * Library worker: download → validate → split → write, off the main thread.
 *
 * Request   { id, type: 'install', identify, url, overlays, category }   (category = raw category.json;
 *             overlays = { kind: url } to lay over the master, core/overlay.js)
 *           { id, type: 'import', identify, text, format, info, category }
 *           { id, type: 'pack',   identify, files, info, category }
 *           { id, type: 'export', identify, format, books, options, notes, category }
 *           { id, type: 'probe', identify, category }
 * Progress  { id, type: 'progress', phase: 'download'|'overlay'|'convert'|'validate'|'write', received? }
 * Result    { id, type: 'done', identify, version, stats, diagnostics, report? }
 * Failure   { id, type: 'error', message }
 *
 * An import differs from an install in one step and no more: where the text
 * came from, and one conversion before it is checked. Everything after the
 * conversion — the validator, the canon report, the write — is the same code,
 * which is the point. A file somebody made in a spreadsheet is held to the
 * standard a published one is, and gets the same account of where it departs
 * from the canon.
 */

import { parseCategory } from '../core/category.js';
import { convert, slug } from '../core/formats/index.js';
import { readPack } from '../core/formats/pack.js';
import { write } from '../core/formats/write.js';
import { applyOverlays } from '../core/overlay.js';
import { hasStrongs } from '../core/strongs.js';
import { parseTranslation } from '../core/translation.js';
import { readStudyFile } from '../core/studydata.js';
import { openStore } from '../services/store.js';

let storePromise = null;
let category = null;

self.addEventListener('message', async ({ data }) => {
  const { id, type } = data;
  const post = (msg) => self.postMessage({ id, ...msg });
  try {
    const jobs = { install, import: importFile, pack: importPack, export: exportFiles, probe, study: importStudy };
    if (!jobs[type]) throw new Error(`library worker: unknown request type ${type}`);
    storePromise ??= openStore();
    category ??= parseCategory(data.category);
    const result = await jobs[type](data, post);
    post({ type: 'done', ...result });
  } catch (err) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
});

/**
 * Study data the reader brought (core/studydata.js): read, then kept by part
 * — a chapter's cross-references to a row, a dictionary whole — in one
 * transaction. A set with the same name and type replaces the one before.
 */
async function importStudy({ text, name, studyType }, post) {
  post({ type: 'progress', phase: 'convert' });
  const read = readStudyFile(text, { source: name, type: studyType ?? null });
  const id = `${read.type}:${slug(read.name)}`;
  const parts = read.type === 'crossrefs' ? read.links : { entries: read.entries };
  const meta = {
    id, type: read.type, format: read.format, name: read.name, source: read.source, licence: read.licence,
    count: read.count, outside: read.outside ?? 0, file: name, bytes: text.length, installedAt: new Date().toISOString(),
  };
  post({ type: 'progress', phase: 'write' });
  const store = await storePromise;
  await store.putStudySet(meta, parts);
  return { meta };
}

async function install({ identify, url, overlays = {} }, post) {
  post({ type: 'progress', phase: 'download', received: 0 });
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);

  const bytes = await readAll(res, (received) => post({ type: 'progress', phase: 'download', received }));
  post({ type: 'progress', phase: 'validate' });
  let raw;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new Error(`${identify}.json: invalid JSON (${err.message})`);
  }
  // What is laid over the master goes on before it is validated, so the
  // result is held to the same standard as a file that came that way.
  const laid = {};
  let size = bytes.byteLength;
  for (const [kind, from] of Object.entries(overlays)) {
    post({ type: 'progress', phase: 'overlay', received: 0 });
    const got = await fetch(from, { cache: 'no-cache' });
    if (!got.ok) throw new Error(`GET ${from}: HTTP ${got.status}`);
    const body = await readAll(got, (received) => post({ type: 'progress', phase: 'overlay', received }));
    size += body.byteLength;
    try {
      laid[kind] = JSON.parse(new TextDecoder().decode(body));
    } catch (err) {
      throw new Error(`${kind}/${identify}.json: invalid JSON (${err.message})`);
    }
  }
  post({ type: 'progress', phase: 'validate' });
  const applied = applyOverlays(raw, laid);
  const parsed = parseTranslation(raw, { identify, category });

  post({ type: 'progress', phase: 'write' });
  const store = await storePromise;
  await store.install(parsed, { bytes: size, overlays: applied });
  return { identify, version: parsed.meta.version, stats: parsed.stats, diagnostics: parsed.diagnostics, overlays: applied };
}

/**
 * A file the reader gave, in whatever format they said it was.
 *
 * The identify is the reader's, not the file's: `parseTranslation` cross-checks
 * the two and refusing somebody's own file because its internal name differs
 * from what they called it would be pedantry. `convert` has already put their
 * answer into the shape, so the check passes by construction and still guards
 * the catalog path, where the two really must agree.
 */
async function importFile({ identify, text, format, info, dialect, delimiter }, post) {
  post({ type: 'progress', phase: 'convert' });
  const { raw, report } = convert({
    text, format, source: info?.source ?? `${identify}`, category,
    info: { ...info, identify }, dialect, delimiter,
  });

  post({ type: 'progress', phase: 'validate' });
  const parsed = parseTranslation(raw, { identify, category });

  post({ type: 'progress', phase: 'write' });
  const store = await storePromise;
  await store.install(parsed, { bytes: text.length, source: report.format });
  return {
    identify,
    version: parsed.meta.version,
    stats: parsed.stats,
    diagnostics: parsed.diagnostics,
    report,
  };
}

/**
 * A whole published bundle — the scripture, its book names, its metadata —
 * assembled and then checked exactly as a single file is.
 */
async function importPack({ identify, files, info }, post) {
  post({ type: 'progress', phase: 'convert' });
  const { raw, report } = readPack(files, { category, source: info?.source ?? identify, info: { ...info, identify } });

  // A bundle states its language as a bare code; the app's own shape wants the
  // block around it. A browserBible text arrives with the block already built
  // (its info.json names the language and its direction), and is kept as it is.
  const language = typeof raw.info.language === 'object' && raw.info.language ? raw.info.language : {
    text: raw.info.languageText || raw.info.language || 'Unknown',
    name: raw.info.language || 'und',
    iso: { '639-1': '', '639-3': /^[a-z]{3}$/i.test(raw.info.language ?? '') ? raw.info.language : '' },
    textdirection: raw.info.textdirection === 'rtl' ? 'rtl' : 'ltr',
  };

  post({ type: 'progress', phase: 'validate' });
  const parsed = parseTranslation({ ...raw, identify, info: { ...raw.info, identify, language } },
    { identify, category });

  post({ type: 'progress', phase: 'write' });
  const store = await storePromise;
  const bytes = files.reduce((n, file) => n + file.text.length, 0);
  await store.install(parsed, { bytes, source: report.format });
  return { identify, version: parsed.meta.version, stats: parsed.stats, diagnostics: parsed.diagnostics, report };
}

/**
 * The reverse: a translation the reader holds, written out in the format they
 * asked for. The chapters are read here rather than on the main thread because
 * a whole Bible is thirty thousand rows and the reader should still be able to
 * scroll while it happens.
 */
/**
 * What a translation actually carries, so the export dialog offers to leave
 * out only what is there: a chip for Strong's numbers on a text without any is
 * a question with no meaning. Stops reading as soon as all three are found.
 */
async function probe({ identify }) {
  const store = await storePromise;
  const found = { strongs: false, headings: false, references: false };
  const all = () => found.strongs && found.headings && found.references;
  await store.scanChapters(identify, (row) => {
    for (const verse of Object.values(row.verses ?? {})) {
      if (!found.strongs && hasStrongs(String(verse?.text ?? ''))) found.strongs = true;
      if (verse?.title) found.headings = true;
      if (verse?.ref) found.references = true;
    }
  }, { while: () => !all() });
  return { identify, has: found };
}

async function exportFiles({ identify, format, books, options = {}, notes = [] }, post) {
  post({ type: 'progress', phase: 'read' });
  const store = await storePromise;
  const meta = await store.getMeta(identify);
  const wanted = Array.isArray(books) && books.length ? new Set(books.map(Number)) : null;

  const chapters = [];
  await store.scanChapters(identify, (row) => {
    if (!wanted || wanted.has(row.book)) chapters.push(row);
  }, wanted ? { books: [...wanted] } : {});

  post({ type: 'progress', phase: 'convert' });
  const files = write(format, {
    meta,
    chapters,
    bookName: (id) => meta.books?.[id]?.name ?? category.book(id).name,
    englishName: (id) => category.book(id).name,
    notes: wanted ? notes.filter((note) => wanted.has(note.book)) : notes,
  }, options);
  return { identify, files, count: chapters.length };
}

async function readAll(res, onProgress) {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received - lastReport > 256 * 1024) { onProgress(received); lastReport = received; }
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
