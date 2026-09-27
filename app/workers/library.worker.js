/**
 * Library worker: download → validate → split → write, off the main thread.
 *
 * Request   { id, type: 'install', identify, url, category }   (category = raw category.json)
 *           { id, type: 'import', identify, text, format, info, category }
 * Progress  { id, type: 'progress', phase: 'download'|'convert'|'validate'|'write', received? }
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
import { convert } from '../core/formats/index.js';
import { parseTranslation } from '../core/translation.js';
import { openStore } from '../services/store.js';

let storePromise = null;
let category = null;

self.addEventListener('message', async ({ data }) => {
  const { id, type } = data;
  const post = (msg) => self.postMessage({ id, ...msg });
  try {
    if (type !== 'install' && type !== 'import') throw new Error(`library worker: unknown request type ${type}`);
    storePromise ??= openStore();
    category ??= parseCategory(data.category);
    const result = type === 'install' ? await install(data, post) : await importFile(data, post);
    post({ type: 'done', ...result });
  } catch (err) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
});

async function install({ identify, url }, post) {
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
  const parsed = parseTranslation(raw, { identify, category });

  post({ type: 'progress', phase: 'write' });
  const store = await storePromise;
  await store.install(parsed, { bytes: bytes.byteLength });
  return { identify, version: parsed.meta.version, stats: parsed.stats, diagnostics: parsed.diagnostics };
}

/**
 * A file the reader gave us, in whatever format they said it was.
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
