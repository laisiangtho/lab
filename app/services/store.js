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
const DB_VERSION = 6;
const DIAGNOSTIC_LIMIT = 400;

/**
 * @param {{ name?: string, onLost?: (reason: string) => void }} [options]
 *   onLost is called when the connection is closed from outside this tab — an
 *   upgrade started elsewhere, or the browser dropping the database. Everything
 *   after that point would fail one call at a time, so the caller is told once.
 */
/** Chapters read per request when a translation is scanned (see #scanRange). */
const SCAN_PAGE = 100;

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
      // A lexicon is megabytes, so it gets a store of its own rather than a
      // place in `records`, which is read whole at startup. Added in v5.
      if (!d.objectStoreNames.contains('lexicon')) d.createObjectStore('lexicon', { keyPath: 'id' });
      // Downloaded guide answers, one row per file, keyed by its path in the
      // catalog repository. Not in `records`: those travel in every settings
      // export, and these are the catalog's, fetched again at will. Added in v6.
      if (!d.objectStoreNames.contains('guide')) d.createObjectStore('guide', { keyPath: 'path' });
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
    return all.map(({ identify, version, info, bytes, installedAt, stats, diagnostics, source }) => (
      { identify, version, info, bytes, installedAt, stats: stats ?? null, diagnostics: diagnostics ?? null, source: source ?? null }));
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
   * `source` marks where the file came from when it was not the catalog — the
   * name of the format it was imported from. The library reads it to tell a
   * translation the reader brought themselves from one that has merely been
   * dropped from the catalog, which are different situations and were shown as
   * the same one.
   *
   * @param {{ meta: object, chapters: {book:number,chapter:number,verses:object}[], stats?: object, diagnostics?: object[] }} parsed
   * @param {{ bytes: number, source?: string|null }} info
   */
  async install(parsed, { bytes, source = null }) {
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
      source,
      // A translation missing most of the canon produces thousands of these;
      // the count is what a reader needs, the list is what a report needs.
      //
      // The counts are kept *by kind*, because "50 differences" told a reader
      // nothing they could act on: a missing book and a chapter one verse short
      // are not the same news, and the list is capped, so the breakdown cannot
      // be recovered from it afterwards.
      diagnostics: {
        total: found.length,
        missing: found.filter((d) => d.type === 'missing-book').length,
        short: found.filter((d) => d.type === 'versification').length,
        extra: found.filter((d) => d.type === 'extra-chapter').length,
        items: found.slice(0, DIAGNOSTIC_LIMIT),
      },
    });
    await done(tx);
  }

  /** A lexicon this device has already fetched, or null. */
  async getLexicon(id) {
    const row = await request(this.#tx('lexicon').objectStore('lexicon').get(id));
    return row?.entries ?? null;
  }

  async putLexicon(id, entries, meta = {}) {
    const tx = this.#tx('lexicon', 'readwrite');
    tx.objectStore('lexicon').put({ id, entries, ...meta, fetchedAt: new Date().toISOString() });
    await done(tx);
  }

  /** What is held, for the settings page: which lexicons, and how big. */
  async lexicons() {
    const all = await request(this.#tx('lexicon').objectStore('lexicon').getAll());
    return all.map(({ id, entries, bytes, fetchedAt }) => (
      { id, count: Object.keys(entries ?? {}).length, bytes: bytes ?? 0, fetchedAt }));
  }

  /**
   * A source's translation list, kept so the Library opens on it at once and
   * works without a connection; refreshed when the reader asks. Kept in the
   * catalog store beside the catalog, under `source:<id>`.
   */
  async sourceList(id) {
    const row = await request(this.#tx('catalog').objectStore('catalog').get(`source:${id}`));
    return row ? { rows: row.rows, fetchedAt: row.fetchedAt } : null;
  }

  async putSourceList(id, rows) {
    const tx = this.#tx('catalog', 'readwrite');
    tx.objectStore('catalog').put({ id: `source:${id}`, rows, fetchedAt: new Date().toISOString() });
    await done(tx);
  }

  /** Every downloaded guide file: { path, sha, lang, topic, entries, modified, fetchedAt }. */
  async guideFiles() {
    return request(this.#tx('guide').objectStore('guide').getAll());
  }

  /** Put these guide files and take those paths away, in one transaction. */
  async changeGuideFiles({ put = [], remove = [] } = {}) {
    const tx = this.#tx('guide', 'readwrite');
    const files = tx.objectStore('guide');
    for (const row of put) files.put(row);
    for (const path of remove) files.delete(path);
    await done(tx);
  }

  async clearGuideFiles() {
    const tx = this.#tx('guide', 'readwrite');
    tx.objectStore('guide').clear();
    await done(tx);
  }

  async removeLexicon(id) {
    const tx = this.#tx('lexicon', 'readwrite');
    tx.objectStore('lexicon').delete(id);
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

  /**
   * A range of chapters, a page at a time: each `getAll` returns up to
   * SCAN_PAGE records, and the next page starts after the last key read.
   *
   * It was a cursor, one round trip a chapter — 1.35 s to read one Bible's
   * 1,189 chapters for a search, nearly all of it waiting on the database,
   * not matching text. A page keeps what the cursor was for: memory holds a
   * page, not a translation, and a newer search can stop this one between
   * pages. The key is the record's own [identify, book, chapter].
   */
  async #scanRange(range, visit, carryOn) {
    let lower = range.lower;
    let lowerOpen = range.lowerOpen;
    for (;;) {
      if (carryOn && !carryOn()) return;
      const page = IDBKeyRange.bound(lower, range.upper, lowerOpen, range.upperOpen);
      const records = await request(this.#tx('chapters').objectStore('chapters').getAll(page, SCAN_PAGE));
      for (const record of records) {
        if (carryOn && !carryOn()) return;
        visit(record);
      }
      if (records.length < SCAN_PAGE) return;
      const last = records[records.length - 1];
      lower = [last.identify, last.book, last.chapter];
      lowerOpen = true;
    }
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
