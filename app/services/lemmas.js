/**
 * The gathered Strong's numbers of the translations on this device, and which
 * of them are the original languages.
 *
 * An index (core/lemmas.js) is built the first time a word in a translation
 * is studied — one pass over its chapters, a second or two for a whole tagged
 * Bible — and kept, stamped with the install it was built from, so a
 * translation downloaded again is indexed again. Nothing is built for a
 * translation nobody studies.
 *
 * An original is a translation on this device in Hebrew or Aramaic (for the
 * Old Testament) or Greek (for the New) that carries Strong's numbers: what
 * the reader brought, never something fetched on their behalf.
 */

import { addChapter, INDEX_FORMAT, taggedWords } from '../core/lemmas.js';

const HEBREW = new Set(['he', 'hbo', 'heb', 'arc', 'oar']);
const GREEK = new Set(['grc', 'gre', 'ell', 'el']);

/** Which testament a translation is the original of, or null. */
export function originalOf(meta) {
  const lang = meta?.info?.language ?? {};
  const codes = [lang.iso?.['639-1'], lang.iso?.['639-3'], lang.name, lang.code].map((c) => String(c ?? '').toLowerCase()).filter(Boolean);
  const tagged = meta?.stats?.strongs ? meta.stats.strongs.words > 0 : true;
  if (!tagged) return null;
  if (codes.some((c) => HEBREW.has(c))) return 'H';
  if (codes.some((c) => GREEK.has(c))) return 'G';
  return null;
}

export function createLemmas({ store }) {
  const memory = new Map();
  const building = new Map();

  async function metaOf(identify) {
    const meta = (await store.list()).find((row) => row.identify === identify);
    if (!meta) throw new Error(`${identify} is not on this device`);
    return meta;
  }

  /** The index for a translation, built if it has not been. */
  async function index(identify) {
    const meta = await metaOf(identify);
    const stamp = `${INDEX_FORMAT}:${meta.installedAt ?? meta.version ?? ''}`;
    const held = memory.get(identify);
    if (held?.stamp === stamp) return held.index;
    if (building.has(identify)) return building.get(identify);
    const job = (async () => {
      const stored = await store.getLemmas(identify);
      if (stored?.stamp === stamp) {
        memory.set(identify, stored);
        return stored.index;
      }
      const built = { version: meta.version ?? 0, codes: {} };
      await store.scanChapters(identify, (row) => addChapter(built, row));
      await store.putLemmas(identify, stamp, built);
      memory.set(identify, { stamp, index: built });
      return built;
    })();
    building.set(identify, job);
    try { return await job; } finally { building.delete(identify); }
  }

  /** The original on this device for a testament ('H' or 'G'), or null. */
  async function original(testament) {
    const all = await store.list();
    return all.find((meta) => originalOf(meta) === testament) ?? null;
  }

  /** The tagged words of one verse of a translation, with their morphology. */
  async function verseWords(identify, book, chapter, verse) {
    const verses = await store.getChapter(identify, book, chapter, { markup: true });
    const found = verses?.[verse];
    return found ? taggedWords(found.text) : [];
  }

  return { index, original, verseWords };
}
