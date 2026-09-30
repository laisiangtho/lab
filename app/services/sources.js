/**
 * Fetching from the translation sources, and from any address the reader
 * types. The lists themselves are read by core/sources.js.
 *
 * A page may fetch from a site only if the site allows it, and many Bible
 * sites do not. Where the platform can download on the page's behalf (the
 * desktop app, `fetchBytes`), everything goes through that; on the web a
 * refusal is told apart from being offline, and the reader is told what does
 * work — the desktop app, or saving the file and adding it with Add your own.
 */

import { readEbibleCsv, readGetBibleList } from '../core/sources.js';

export function createSources({ store, platform, config }) {
  const viaApp = typeof platform.capabilities?.fetchBytes === 'function';

  /**
   * @returns {Promise<{ bytes: Uint8Array, text: () => string, type: string }>}
   */
  async function download(url, label = url) {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error(`${label}: only https addresses can be downloaded from`);
    let bytes;
    let type = '';
    if (viaApp) {
      const got = await platform.capabilities.fetchBytes(u.href);
      bytes = got.bytes instanceof Uint8Array ? got.bytes : new Uint8Array(got.bytes);
      type = got.type ?? '';
    } else {
      let response;
      try {
        response = await fetch(u.href, { cache: 'no-cache' });
      } catch {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(`${label}: there is no connection`);
        throw new Error(`${label}: ${u.host} does not let web pages download from it. The desktop app can; or save the file and add it with Add your own.`);
      }
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status} from ${u.host}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      type = response.headers.get('content-type') ?? '';
    }
    return { bytes, type, text: () => new TextDecoder().decode(bytes) };
  }

  const READERS = {
    getbible: { url: () => config.getbibleListUrl, read: (file) => readGetBibleList(JSON.parse(file.text())) },
    ebible: { url: () => config.ebibleListUrl, read: (file) => readEbibleCsv(file.text(), { base: config.ebibleFilesUrl }) },
  };

  /**
   * A source's list: the kept copy unless `refresh`, or when there is none.
   * @returns {Promise<{ rows: object[], fetchedAt: string }>}
   */
  async function list(id, { refresh = false } = {}) {
    const reader = READERS[id];
    if (!reader) throw new Error(`sources: no source called "${id}"`);
    if (!refresh) {
      const kept = await store.sourceList(id);
      if (kept) return kept;
    }
    const rows = reader.read(await download(reader.url(), id === 'getbible' ? 'getBible' : 'eBible.org'));
    await store.putSourceList(id, rows);
    return store.sourceList(id);
  }

  return { list, download, viaApp };
}
