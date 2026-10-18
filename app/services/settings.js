/**
 * Persisted settings, stored in IndexedDB next to the translations so an
 * exported file and the live state always describe the same thing.
 *
 * Writes are coalesced: chapter stepping fires rapidly and each step would
 * otherwise cost a transaction.
 */

import { defaultSettings, migrateSettings, parseSettings } from '../core/settings.js';

const WRITE_DELAY_MS = 250;
/** Keys that change rapidly enough to be worth coalescing. */
const COALESCED = new Set(['book', 'chapter']);

function same(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

export async function createSettings({ store, category }) {
  const stored = await store.getSettings();
  const migrated = stored ? migrateSettings(stored) : { raw: null, notes: [] };
  let value = migrated.raw
    ? parseSettings(migrated.raw, { source: 'stored settings', category })
    : Object.freeze({ ...defaultSettings });
  let timer = null;
  let onError = (err) => console.error(`settings: ${err.message}`);

  function flush() {
    timer = null;
    store.putSettings(value).catch(onError);
  }

  return {
    /** What the migration had to leave behind, for the shell to report once. */
    notes: migrated.notes,
    get: () => value,
    /** Replace settings (validated) and persist them. */
    set(patch) {
      const previous = value;
      value = parseSettings({ ...value, ...patch }, { source: 'settings', category });
      const changed = Object.keys(value).filter((k) => !same(previous[k], value[k]));
      if (!changed.length) return value;
      if (changed.every((k) => COALESCED.has(k))) {
        if (timer === null) timer = setTimeout(flush, WRITE_DELAY_MS);
      } else {
        if (timer !== null) clearTimeout(timer);
        flush();
      }
      return value;
    },
    /** Persist immediately — used before export so the file matches the UI. */
    async save() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      await store.putSettings(value);
    },
    /** Write a held-back change now, if there is one: the page is going away. */
    flushPending() {
      if (timer === null) return;
      clearTimeout(timer);
      flush();
    },
    onError: (fn) => { onError = fn; },
  };
}
