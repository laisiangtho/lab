/**
 * Fetching from the translation sources, and from any address the reader
 * types. The lists themselves are read by core/sources.js.
 *
 * A page may read what another site sends only if the site allows it (CORS),
 * and many Bible sites do not. Where the platform can download on the page's
 * behalf (the desktop app, `fetchBytes`), everything goes through that. On
 * the web a failure says which it was — no connection, a site that could not
 * be reached, a site that answered but does not allow it, an HTTP status —
 * as `err.code`, so the caller can offer what does work.
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
        throw await whyNot(u, label);
      }
      if (!response.ok) throw failure('status', `${label}: HTTP ${response.status} from ${u.host}`, u, { status: response.status });
      bytes = new Uint8Array(await response.arrayBuffer());
      type = response.headers.get('content-type') ?? '';
    }
    return { bytes, type, text: () => new TextDecoder().decode(bytes) };
  }

  /**
   * Why a download a web page asked for failed. A browser reports a site
   * that does not allow other pages to read it (no CORS header), a site that
   * could not be reached, and a lost connection as one and the same error,
   * so a second request is made that asks for nothing back (`no-cors`): if
   * that one is answered, the site is there and the refusal is the
   * browser's on its behalf.
   */
  async function whyNot(u, label) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return failure('offline', `${label}: there is no connection`, u);
    }
    try {
      await fetch(u.href, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      return failure('unreachable', `${label}: ${u.host} could not be reached`, u);
    }
    return failure('cors', `${label}: ${u.host} answered, but does not allow a web page to read what it sends (it sends no CORS header). The desktop app is not limited by this.`, u);
  }

  /** An error a caller can act on: `code` is offline, unreachable, cors or status. */
  function failure(code, message, u, more = {}) {
    return Object.assign(new Error(message), { code, host: u.host, url: u.href, ...more });
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
