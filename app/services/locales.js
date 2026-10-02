/**
 * Interface languages from the catalog repository (core/locale.js): what is
 * offered there, what is kept on this device, and fetching one.
 *
 * English and Norwegian are part of the app. The others are fetched when a
 * reader chooses one and kept in the `locales` store, so the next start reads
 * it from the device with no network at all.
 */

import { parseLocale, parseLocaleIndex } from '../core/locale.js';
import { fetchJson } from './library.js';

/**
 * @param {{ store: object, config: { repoFileUrl: string } }} deps
 */
export function createLocales({ store, config }) {
  const url = (path) => config.repoFileUrl.replace('{path}', path);
  let listed = null;

  return Object.freeze({
    /** The languages kept on this device, whole. */
    held: () => store.locales(),

    /**
     * What the catalog repository offers. Asked once a session; a failure is
     * the caller's to report, and is asked again next time.
     */
    offered() {
      listed ??= fetchJson(url('locale/index.json'), 'the list of interface languages', { cache: 'no-cache' })
        .then((raw) => parseLocaleIndex(raw))
        .catch((err) => { listed = null; throw err; });
      return listed;
    },

    /**
     * Fetch one language and keep it. `version` is the index's fingerprint
     * for it, kept with the copy so a later start can tell an old one.
     */
    async get(code, version = null) {
      const raw = await fetchJson(url(`locale/${encodeURIComponent(code)}.json`), `the ${code} interface`, { cache: 'no-cache' });
      const record = { ...parseLocale(raw, code), version, fetchedAt: new Date().toISOString() };
      await store.putLocale(record);
      return record;
    },
  });
}
