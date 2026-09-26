/**
 * Search worker: scans installed translations chapter by chapter.
 *
 * No index is built at install time. A chapter cursor keeps memory flat, and
 * results stream back in batches so the first hits appear while the rest of the
 * translation is still being read. A newer query cancels an older one.
 *
 * What comes back is counted as it goes: how many verses matched, in how many
 * chapters, in how many books, and where — so the reader is told the shape of
 * the answer, not only its first forty lines.
 *
 * Request   { id, type: 'search', query, translations: [identify], books, options, limit }
 * Progress  { id, type: 'batch', rows: [...], counts }
 * Result    { id, type: 'done', total, verses, chapters, books, scanned, ms, truncated, byBook }
 */

import { createMatcher, snippet } from '../core/search.js';
import { openStore } from '../services/store.js';

const BATCH = 40;

let storePromise = null;
let current = 0;

self.addEventListener('message', async ({ data }) => {
  const { id, type } = data;
  const post = (msg) => self.postMessage({ id, ...msg });
  current = id;
  try {
    if (type !== 'search') throw new Error(`search worker: unknown request type ${type}`);
    storePromise ??= openStore();
    await search(data, post);
  } catch (err) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
});

async function search({ id, query, translations, books = null, options = {}, limit = 2000 }, post) {
  const matcher = createMatcher(query, options);
  if (!matcher) { post({ type: 'done', ...empty() }); return; }

  const store = await storePromise;
  const started = performance.now();
  const mine = () => current === id;

  let rows = [];
  let verses = 0;
  let scanned = 0;
  let kept = 0;
  let truncated = false;
  /** book id → { verses, chapters: Set } — the shape of the answer. */
  const byBook = new Map();

  for (const identify of translations) {
    if (!mine()) return;
    await store.scanChapters(identify, (record) => {
      if (!mine()) return;
      scanned += 1;
      let inChapter = 0;
      for (const [key, verse] of Object.entries(record.verses)) {
        const ranges = matcher.test(verse.text);
        if (!ranges) continue;
        verses += 1;
        inChapter += 1;
        // Counting continues past the limit: a reader who searches for a common
        // word is told there are nine thousand of them, and shown the first
        // few hundred. Only the rows stop.
        if (kept < limit) {
          kept += 1;
          rows.push({
            identify, book: record.book, chapter: record.chapter, verse: Number(key),
            merge: verse.merge ?? null, ...snippet(verse.text, ranges),
          });
          if (rows.length >= BATCH) { post({ type: 'batch', rows, counts: counts() }); rows = []; }
        } else {
          truncated = true;
        }
      }
      if (inChapter) {
        const entry = byBook.get(record.book) ?? { verses: 0, chapters: new Set() };
        entry.verses += inChapter;
        entry.chapters.add(record.chapter);
        byBook.set(record.book, entry);
      }
    }, { books, while: mine });
  }

  if (!mine()) return;
  if (rows.length) post({ type: 'batch', rows, counts: counts() });
  post({
    type: 'done',
    ...counts(),
    total: verses,
    scanned,
    truncated,
    ms: Math.round(performance.now() - started),
    byBook: [...byBook.entries()].map(([book, v]) => ({ book, verses: v.verses, chapters: v.chapters.size })),
  });

  function counts() {
    let chapters = 0;
    for (const entry of byBook.values()) chapters += entry.chapters.size;
    return { verses, chapters, books: byBook.size, shown: kept };
  }
}

function empty() {
  return { total: 0, verses: 0, chapters: 0, books: 0, shown: 0, scanned: 0, ms: 0, truncated: false, byBook: [] };
}
