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
  /**
   * Bumped whenever a set changes. A read that was under way when it did
   * returns what it found but does not put it in a cache: that answer is of
   * the sets as they were.
   */
  let age = 0;
  const forget = () => { age += 1; chapters.clear(); entries.clear(); sets = null; verseIndex = null; };

  async function list() {
    if (sets) return sets;
    const born = age;
    const read = (await store.studySets()).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    if (born === age) sets = read;
    return read;
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
    const born = age;
    const byVerse = {};
    for (const set of (await list()).filter((s) => s.type === 'crossrefs')) {
      const links = (await store.studyPart(set.id, key)) ?? [];
      for (const [verse, b, c, v, c2, v2, votes] of links) {
        if (votes < 0) continue;
        (byVerse[verse] ??= []).push({ set: set.id, ref: [b, c, v, c2, v2], votes });
      }
    }
    for (const list of Object.values(byVerse)) list.sort((a, b) => b.votes - a.votes);
    if (born === age) chapters.set(key, byVerse);
    return byVerse;
  }

  async function entriesOf(id) {
    if (!entries.has(id)) {
      const reading = (async () => (await store.studyPart(id, 'entries')) ?? [])();
      entries.set(id, reading);
      // A read that failed is not kept: the next one asking tries again.
      reading.catch(() => { if (entries.get(id) === reading) entries.delete(id); });
    }
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

  /** Every topical index's entries with their verses filed (core `topicsByVerse`), while no set changes. */
  let verseIndex = null;
  async function indexed() {
    if (verseIndex) return verseIndex;
    const born = age;
    const all = await topics();
    const built = { all, index: topicsByVerse(all) };
    if (born === age) verseIndex = built;
    return built;
  }

  /** The topics a verse is filed under, across every topical index. */
  async function topicsFor(book, chapter, verse) {
    const { all, index } = await indexed();
    const found = new Set([
      ...(index.get(`${book}.${chapter}.${verse}`) ?? []),
      ...(index.get(`${book}.${chapter}.0`) ?? []),
    ]);
    return [...found].map((i) => all[i]);
  }

  /**
   * The topics a chapter's verses are filed under, the most verses first:
   * [{ entry, verses }]. A topic that cites the whole chapter is on the list
   * with no verse named.
   */
  async function topicsIn(book, chapter) {
    const { all, index } = await indexed();
    const prefix = `${book}.${chapter}.`;
    const hits = new Map();
    for (const [key, found] of index) {
      if (!key.startsWith(prefix)) continue;
      const verse = Number(key.slice(prefix.length));
      for (const i of found) {
        if (!hits.has(i)) hits.set(i, []);
        if (verse > 0) hits.get(i).push(verse);
      }
    }
    return [...hits].map(([i, verses]) => ({ entry: all[i], verses: verses.sort((x, y) => x - y) }))
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


  return {
    list, importFile, remove, crossrefs, topics, topicsFor, topicsIn, dictionary, lookup,
    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}
