/**
 * IndexedDB storage for offline translations and the fetched catalog.
 *
 * Object stores
 *   translations  key: identify                  value: parsed meta + install info
 *   chapters      key: [identify, book, chapter] value: { identify, book, chapter, verses }
 *   catalog       key: 'current'                 value: { id, raw, fetchedAt }
 *   settings      key: 'current'                 value: { id, ...settings }
 *   records       key: feature key               value: { id, value } — feature-owned
 *                                                documents (plan progress, board, ink)
 *   notes         key: id                        value: note (keyed on the passage, not a translation)
 *   marks         key: "book.chapter.verse"      value: bookmark
 *
 * Works in the main thread and in workers. Install and remove are single
 * transactions: a failed install leaves the previous copy untouched.
 */

const DB_NAME = 'lai-siangtho';
const DB_VERSION = 4;
const DIAGNOSTIC_LIMIT = 400;

/**
 * @param {{ name?: string, onLost?: (reason: string) => void }} [options]
 *   onLost is called when the connection is closed from outside this tab — an
 *   upgrade started elsewhere, or the browser dropping the database. Everything
 *   after that point would fail one call at a time, so the caller is told once.
 */
export async function openStore({ name = DB_NAME, onLost = null } = {}) {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this environment');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('translations')) d.createObjectStore('translations', { keyPath: 'identify' });
      if (!d.objectStoreNames.contains('chapters')) d.createObjectStore('chapters', { keyPath: ['identify', 'book', 'chapter'] });
      if (!d.objectStoreNames.contains('catalog')) d.createObjectStore('catalog', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' }); // added in v2
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }); // added in v3
      if (!d.objectStoreNames.contains('marks')) d.createObjectStore('marks', { keyPath: 'id' }); // added in v3
      if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' }); // added in v4
    };
    req.onblocked = () => reject(new Error('Another window of this app is open with an older version of its storage. Close the other windows and reload.'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
  });
  db.onversionchange = () => { db.close(); onLost?.('A newer version of this app opened in another window.'); };
  db.onclose = () => onLost?.('The browser closed this app\'s storage.');
  return new TranslationStore(db);
}

/** Delete everything this app has stored. The caller reloads afterwards. */
export function resetStore({ name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onblocked = () => reject(new Error('Storage is in use by another window of this app. Close the other windows and try again.'));
    req.onerror = () => reject(req.error);
  });
}

/**
 * A storage failure a reader can act on. The browser's own wording for a full
 * quota names neither the app nor the remedy, so it is replaced; everything
 * else is passed through as it came.
 */
export function storageError(err) {
  if (err?.name === 'QuotaExceededError') {
    return new Error('There is no room left for this. Remove a translation you no longer read, or free space on this device, and try again.');
  }
  return err ?? new Error('storage failed');
}

class TranslationStore {
  #db;

  constructor(db) {
    this.#db = db;
  }

  /** Installed translations, without the chapter text. */
  async list() {
    const all = await request(this.#tx('translations').objectStore('translations').getAll());
    return all.map(({ identify, version, info, bytes, installedAt, stats, diagnostics }) => (
      { identify, version, info, bytes, installedAt, stats: stats ?? null, diagnostics: diagnostics ?? null }));
  }

  async getMeta(identify) {
    const meta = await request(this.#tx('translations').objectStore('translations').get(identify));
    if (!meta) throw new Error(`translation ${identify} is not installed`);
    return meta;
  }

  /** @returns {Promise<Record<string, object> | null>} verses, or null when the translation lacks the chapter */
  async getChapter(identify, book, chapter) {
    const rec = await request(this.#tx('chapters').objectStore('chapters').get([identify, book, chapter]));
    return rec ? rec.verses : null;
  }

  /**
   * Replace (or create) a translation atomically. What the parse learned about
   * the file — its totals, and where it departs from the canon — is kept with
   * it, so the reader can be shown why a chapter is short long after the
   * install that found out.
   * @param {{ meta: object, chapters: {book:number,chapter:number,verses:object}[], stats?: object, diagnostics?: object[] }} parsed
   * @param {{ bytes: number }} info
   */
  async install(parsed, { bytes }) {
    const { identify } = parsed.meta;
    const found = parsed.diagnostics ?? [];
    const tx = this.#tx(['translations', 'chapters'], 'readwrite');
    const chapters = tx.objectStore('chapters');
    // Array keys sort after numbers, so [identify, []] is greater than every
    // [identify, book, chapter]; the range covers exactly this translation.
    chapters.delete(IDBKeyRange.bound([identify], [identify, []]));
    for (const c of parsed.chapters) chapters.put({ identify, book: c.book, chapter: c.chapter, verses: c.verses });
    tx.objectStore('translations').put({
      ...parsed.meta,
      bytes,
      installedAt: new Date().toISOString(),
      stats: parsed.stats ?? null,
      // A translation missing most of the canon produces thousands of these;
      // the count is what a reader needs, the list is what a report needs.
      diagnostics: { total: found.length, items: found.slice(0, DIAGNOSTIC_LIMIT) },
    });
    await done(tx);
  }

  async remove(identify) {
    const tx = this.#tx(['translations', 'chapters'], 'readwrite');
    tx.objectStore('chapters').delete(IDBKeyRange.bound([identify], [identify, []]));
    tx.objectStore('translations').delete(identify);
    await done(tx);
  }

  /** @returns {Promise<{ raw: unknown, fetchedAt: string } | null>} */
  async getCatalog() {
    const rec = await request(this.#tx('catalog').objectStore('catalog').get('current'));
    return rec ? { raw: rec.raw, fetchedAt: rec.fetchedAt } : null;
  }

  async putCatalog(raw, fetchedAt = new Date().toISOString()) {
    const tx = this.#tx('catalog', 'readwrite');
    tx.objectStore('catalog').put({ id: 'current', raw, fetchedAt });
    await done(tx);
  }

  /**
   * Walk the chapters of a translation. Used by search, which reads far more
   * than it keeps: a cursor avoids holding the whole translation in memory.
   *
   * A search limited to a few books opens one cursor per book rather than
   * reading the whole translation and discarding most of it — the key is
   * `[identify, book, chapter]`, so each book is one contiguous range.
   *
   * @param {(record: {book:number,chapter:number,verses:object}) => void} visit
   * @param {{ books?: number[] | null, while?: () => boolean }} [options]
   *   `while` is asked between records; returning false stops the scan, which
   *   is how a newer query abandons an older one mid-translation.
   */
  async scanChapters(identify, visit, { books = null, while: carryOn = null } = {}) {
    const ranges = books?.length
      ? [...books].sort((a, b) => a - b).map((book) => IDBKeyRange.bound([identify, book], [identify, book, []]))
      : [IDBKeyRange.bound([identify], [identify, []])];
    for (const range of ranges) {
      if (carryOn && !carryOn()) return;
      await this.#scanRange(range, visit, carryOn);
    }
  }

  #scanRange(range, visit, carryOn) {
    return new Promise((resolve, reject) => {
      const tx = this.#tx('chapters');
      const request = tx.objectStore('chapters').openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        if (carryOn && !carryOn()) { resolve(); return; }
        visit(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Notes and bookmarks: small records, read whole and filtered by the caller. */
  async annotations() {
    const [notes, marks] = await Promise.all([
      request(this.#tx('notes').objectStore('notes').getAll()),
      request(this.#tx('marks').objectStore('marks').getAll()),
    ]);
    return { notes, marks };
  }

  async putAnnotation(kind, record) {
    const tx = this.#tx(kind, 'readwrite');
    tx.objectStore(kind).put(record);
    await done(tx);
  }

  async deleteAnnotation(kind, id) {
    const tx = this.#tx(kind, 'readwrite');
    tx.objectStore(kind).delete(id);
    await done(tx);
  }

  /** Bulk replace used by import; existing records with the same id are overwritten. */
  async mergeAnnotations({ notes = [], marks = [] }) {
    const tx = this.#tx(['notes', 'marks'], 'readwrite');
    for (const note of notes) tx.objectStore('notes').put(note);
    for (const mark of marks) tx.objectStore('marks').put(mark);
    await done(tx);
  }

  /** @returns {Promise<object|null>} raw settings; validation belongs to the caller */
  async getSettings() {
    const rec = await request(this.#tx('settings').objectStore('settings').get('current'));
    if (!rec) return null;
    const { id, ...settings } = rec;
    return settings;
  }

  async putSettings(settings) {
    const tx = this.#tx('settings', 'readwrite');
    tx.objectStore('settings').put({ id: 'current', ...settings });
    await done(tx);
  }

  /**
   * Feature records: whatever a feature keeps that is too large or too much its
   * own shape for settings — plan progress, board cards, ink strokes.
   * @returns {Promise<Record<string, unknown>>} every record, by key
   */
  async records() {
    const all = await request(this.#tx('records').objectStore('records').getAll());
    return Object.fromEntries(all.map(({ id, value }) => [id, value]));
  }

  async putRecord(id, value) {
    const tx = this.#tx('records', 'readwrite');
    tx.objectStore('records').put({ id, value });
    await done(tx);
  }

  async deleteRecord(id) {
    const tx = this.#tx('records', 'readwrite');
    tx.objectStore('records').delete(id);
    await done(tx);
  }

  #tx(names, mode = 'readonly') {
    return this.#db.transaction(names, mode);
  }
}

/** Storage usage and persistence state for the whole origin. */
export async function storageStatus() {
  if (!navigator.storage?.estimate) return { usage: null, quota: null, persisted: null };
  const [{ usage, quota }, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(null),
  ]);
  return { usage, quota, persisted };
}

/**
 * Ask the browser not to evict stored data under pressure. Browsers may grant
 * silently, prompt, or refuse; the result is reported, never assumed.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError(tx.error));
    tx.onabort = () => reject(storageError(tx.error ?? new Error('The write was abandoned before it finished.')));
  });
}
