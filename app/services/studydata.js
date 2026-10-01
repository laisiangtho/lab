/**
 * The study data on this device — cross-references, topical indexes,
 * dictionaries the reader imported (core/studydata.js) — and what the
 * reading asks of it.
 *
 * A set is imported in the library worker (`library.importStudy`) and kept by
 * part; this reads the parts as they are wanted: one chapter's
 * cross-references when the chapter is drawn, a dictionary when it is first
 * opened. What has been read is kept in memory until a set changes.
 */

import { termKey, topicsByVerse } from '../core/studydata.js';

export function createStudyData({ store, library }) {
  const events = new EventTarget();
  /** "b.c" → merged cross-references of every set, while no set changes. */
  const chapters = new Map();
  /** id → entries, for topics and dictionaries. */
  const entries = new Map();
  let sets = null;

  const emit = () => events.dispatchEvent(new CustomEvent('change'));
  const forget = () => { chapters.clear(); entries.clear(); sets = null; };

  async function list() {
    sets ??= (await store.studySets()).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return sets;
  }

  /**
   * Import a file. `studyType` is the reader's answer to "read it as", for a
   * ThML work that could be a dictionary or a topical index.
   */
  async function importFile({ text, name, studyType = null }) {
    const { meta } = await library.importStudy({ text, name, studyType });
    forget();
    emit();
    return meta;
  }

  async function remove(id) {
    await store.removeStudySet(id);
    forget();
    emit();
  }

  /**
   * The cross-references from one chapter, of every set, by verse: "v" →
   * [{ set, ref: [book, chapter, verse, toChapter, toVerse], votes }], the most
   * voted first. A set's links voted below zero are left out: its readers
   * said they were wrong.
   */
  async function crossrefs(book, chapter) {
    const key = `${book}.${chapter}`;
    if (chapters.has(key)) return chapters.get(key);
    const byVerse = {};
    for (const set of (await list()).filter((s) => s.type === 'crossrefs')) {
      const links = (await store.studyPart(set.id, key)) ?? [];
      for (const [verse, b, c, v, c2, v2, votes] of links) {
        if (votes < 0) continue;
        (byVerse[verse] ??= []).push({ set: set.id, ref: [b, c, v, c2, v2], votes });
      }
    }
    for (const list of Object.values(byVerse)) list.sort((a, b) => b.votes - a.votes);
    chapters.set(key, byVerse);
    return byVerse;
  }

  async function entriesOf(id) {
    if (!entries.has(id)) entries.set(id, (async () => (await store.studyPart(id, 'entries')) ?? [])());
    return entries.get(id);
  }

  /** Every topical index's entries, with which set each is from. */
  async function topics() {
    const out = [];
    for (const set of (await list()).filter((s) => s.type === 'topics')) {
      for (const entry of await entriesOf(set.id)) out.push({ ...entry, set: set.id });
    }
    return out;
  }

  /** The topics a verse is filed under, across every topical index. */
  let verseIndex = null;
  async function topicsFor(book, chapter, verse) {
    if (!verseIndex) {
      const all = await topics();
      verseIndex = { all, index: topicsByVerse(all) };
    }
    const found = new Set([
      ...(verseIndex.index.get(`${book}.${chapter}.${verse}`) ?? []),
      ...(verseIndex.index.get(`${book}.${chapter}.0`) ?? []),
    ]);
    return [...found].map((i) => verseIndex.all[i]);
  }

  /**
   * The topics a chapter's verses are filed under, the most verses first:
   * [{ entry, verses }].
   */
  async function topicsIn(book, chapter) {
    if (!verseIndex) {
      const all = await topics();
      verseIndex = { all, index: topicsByVerse(all) };
    }
    const prefix = `${book}.${chapter}.`;
    const hits = new Map();
    for (const [key, found] of verseIndex.index) {
      if (!key.startsWith(prefix)) continue;
      const verse = Number(key.slice(prefix.length));
      for (const i of found) {
        if (!hits.has(i)) hits.set(i, []);
        hits.get(i).push(verse);
      }
    }
    return [...hits].map(([i, verses]) => ({ entry: verseIndex.all[i], verses: verses.sort((x, y) => x - y) }))
      .sort((x, y) => y.verses.length - x.verses.length || x.entry.term.localeCompare(y.entry.term));
  }

  /** Every dictionary's entries, with which set each is from. */
  async function dictionary() {
    const out = [];
    for (const set of (await list()).filter((s) => s.type === 'dictionary')) {
      for (const entry of await entriesOf(set.id)) out.push({ ...entry, set: set.id });
    }
    return out;
  }

  /** Dictionary entries whose term is this word, in any dictionary held. */
  async function lookup(word) {
    const key = termKey(word);
    if (!key) return [];
    return (await dictionary()).filter((entry) => termKey(entry.term) === key);
  }

  events.addEventListener('change', () => { verseIndex = null; });

  return {
    list, importFile, remove, crossrefs, topics, topicsFor, topicsIn, dictionary, lookup,
    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}
