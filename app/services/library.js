/**
 * Library: catalog state, update checks, install / update / remove.
 *
 * Catalog precedence: stored remote catalog → bundled seed. The bundled seed is
 * reported as such (origin: 'bundled') so the UI can say it may be outdated.
 *
 * Events (EventTarget): 'change' after catalog or installed set changes,
 * 'progress' with { identify, phase, received }.
 */

import { compareCatalogs, parseCatalog, translationStatus } from '../core/catalog.js';
import { requestPersistence } from './store.js';

const HOUR = 3_600_000;

/**
 * @param {{ store: any, categoryRaw: unknown, config: any }} deps
 */
export function createLibrary({ store, categoryRaw, config }) {
  const events = new EventTarget();
  let catalog = null;
  let origin = null; // 'stored' | 'bundled'
  let fetchedAt = null;
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  async function load() {
    const stored = await store.getCatalog();
    if (stored) {
      catalog = parseCatalog(stored.raw, { source: 'stored book.json' });
      origin = 'stored';
      fetchedAt = stored.fetchedAt;
    } else {
      const raw = await fetchJson(config.bundledCatalogUrl, 'bundled book.json');
      catalog = parseCatalog(raw, { source: 'bundled book.json' });
      origin = 'bundled';
      fetchedAt = null;
    }
  }

  /**
   * @param {{ force?: boolean }} [options] force ignores updateCheckHours
   * @returns {Promise<{ checked: boolean, changed: boolean }>}
   */
  async function checkForUpdates({ force = false } = {}) {
    if (!force) {
      if (config.updateCheckHours === 0) return { checked: false, changed: false };
      if (fetchedAt && Date.now() - Date.parse(fetchedAt) < config.updateCheckHours * HOUR) return { checked: false, changed: false };
    }
    const raw = await fetchJson(config.catalogUrl, 'remote book.json', { cache: 'no-cache' });
    const remote = parseCatalog(raw, { source: 'remote book.json', requireRemoteShape: true });
    const relation = compareCatalogs(origin === 'stored' ? catalog : null, remote);
    const now = new Date().toISOString();
    if (relation === 'older') {
      throw new Error(`remote book.json (version ${remote.version}) is older than the stored catalog (version ${catalog.version})`);
    }
    await store.putCatalog(raw, now); // also refreshes fetchedAt when unchanged
    catalog = remote;
    origin = 'stored';
    fetchedAt = now;
    emit('change');
    return { checked: true, changed: relation === 'newer' };
  }

  async function status() {
    return translationStatus(catalog, await store.list());
  }

  async function install(identify) {
    const entry = catalog.get(identify);
    if (!entry) throw new Error(`${identify} is not in the catalog`);
    const firstInstall = (await store.list()).length === 0;
    const url = config.translationUrl.replace('{identify}', encodeURIComponent(identify));
    const result = await call({ type: 'install', identify, url, category: categoryRaw }, identify);
    // Not fatal (the file is valid), but reported: the catalog and the file disagree,
    // so "update available" will keep showing until the catalog is corrected.
    result.versionMismatch = result.version !== entry.version ? { catalog: entry.version, file: result.version } : null;
    if (firstInstall) await requestPersistence();
    emit('change');
    return result;
  }

  /**
   * Install a translation the reader supplied, rather than one the catalog
   * named.
   *
   * The catalog is deliberately the only gate on `install`, and this does not
   * weaken it: it is a second door with its own key, and what comes through it
   * is marked as having done so. Nothing else in the app is told to trust it
   * more than a catalog translation, or less.
   *
   * @param {{ text: string, format: string, identify: string, info?: object,
   *           dialect?: string, delimiter?: string }} job
   */
  async function importTranslation({ text, format, identify, info = {}, dialect, delimiter }) {
    const id = String(identify ?? '').trim();
    if (!/^[a-z0-9][a-z0-9._-]{1,31}$/i.test(id)) {
      throw new Error(`"${identify}" cannot be a translation name — letters, digits, dots and dashes, 2 to 32 of them`);
    }
    const already = (await store.list()).some((row) => row.identify === id);
    const firstInstall = (await store.list()).length === 0;
    const result = await call({
      type: 'import', identify: id, text, format, info, dialect, delimiter, category: categoryRaw,
    }, id);
    if (firstInstall) await requestPersistence();
    emit('change');
    return { ...result, replaced: already };
  }

  async function remove(identify) {
    await store.remove(identify);
    emit('change');
  }

  function call(message, identify) {
    worker ??= createWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, identify });
      worker.postMessage({ id, ...message });
    });
  }

  function createWorker() {
    const w = new Worker(new URL('../workers/library.worker.js', import.meta.url), { type: 'module' });
    w.addEventListener('message', ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') { emit('progress', { identify: job.identify, phase: data.phase, received: data.received }); return; }
      pending.delete(data.id);
      if (data.type === 'done') job.resolve(data);
      else job.reject(new Error(data.message));
    });
    w.addEventListener('error', (e) => {
      for (const job of pending.values()) job.reject(new Error(`library worker failed: ${e.message}`));
      pending.clear();
      worker = null;
    });
    return w;
  }

  function emit(type, detail) {
    events.dispatchEvent(new CustomEvent(type, { detail }));
  }

  return {
    load,
    checkForUpdates,
    status,
    install,
    importTranslation,
    remove,
    get catalog() { return catalog; },
    get origin() { return origin; },
    get fetchedAt() { return fetchedAt; },
    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}

export async function fetchJson(url, label, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`${label}: network error (${err.message})`);
  }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  try {
    return await res.json();
  } catch (err) {
    throw new Error(`${label}: invalid JSON (${err.message})`);
  }
}
