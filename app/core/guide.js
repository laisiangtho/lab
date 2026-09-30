/**
 * The guide's matching: a question in, the entries that answer it out.
 *
 * Nothing here writes an answer. Every entry is text the app already carries —
 * a command and what it does, a setting and its sentence, a topic written for
 * the guide — in the interface's language, and the guide's whole job is to
 * find the right one and offer the button that does it. That is why it works
 * offline, in Burmese as well as English, and never states something the app
 * does not do.
 *
 * ## Matching
 *
 * BM25 over the entry's title, its phrasings (the ways somebody might ask for
 * it) and its text, the title and phrasings counting three times. Terms match
 * exactly, or by prefix when both are four characters or more — "bookmark"
 * finds "bookmarks", "notat" finds "notater" — at a discount, so an exact word
 * still wins.
 *
 * Burmese writes no spaces between words, so splitting on spaces would make a
 * sentence one term. A run of Myanmar script is cut into overlapping pairs of
 * characters instead: the question and the entry are cut the same way, so the
 * pairs they share are the words they share, and no dictionary is needed.
 *
 * ## Learning
 *
 * The guide adapts; it does not train. When a reader asks something and then
 * uses an answer — its button, or "Helpful" — the pair is remembered, and a
 * later question that shares most of its words with that one ranks that answer
 * higher. "Not this" does the opposite. The memory is a list of those pairs,
 * capped, kept on the device as a feature record (so it travels in the
 * settings export) and forgotten on request. Nothing leaves the device.
 */

const LATIN_MARKS = /[̀-ͯ]/g;
/** Scripts written without spaces between words: matched by character pairs. */
const UNSPACED = /[က-႟ꩠ-ꩿꧠ-꧿฀-๿຀-໿ក-៿぀-ヿ㐀-鿿]/u;

/**
 * Words that carry no meaning in a question — "how do I", "hvordan kan jeg".
 * Removed from both sides, so "How do I bookmark a verse" is "bookmark verse".
 */
const STOP = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'do', 'does', 'for', 'from', 'get', 'have',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'please', 'should', 'so',
  'that', 'the', 'there', 'this', 'to', 'use', 'want', 'way', 'what', 'when', 'where', 'which', 'who', 'why',
  'will', 'with', 'would', 'you', 'your',
  // Norsk bokmål
  'av', 'de', 'den', 'det', 'du', 'eg', 'en', 'er', 'et', 'for', 'fra', 'få', 'går', 'har', 'hva', 'hvor',
  'hvordan', 'hvorfor', 'i', 'jeg', 'kan', 'med', 'meg', 'min', 'mitt', 'mine', 'nå', 'og', 'om', 'på', 'seg',
  'skal', 'som', 'til', 'vil', 'å',
]);

/**
 * The same for Burmese: question words and endings — "how", "where", the
 * particles that make a sentence a question or a wish. Burmese runs words
 * together, so these are cut out of a run before it is paired rather than
 * matched as words; only ones that cannot be the inside of another word are
 * listed ("ဘာ" is not, being the start of "ဘာသာ", language).
 */
const MY_STOP = ['ဘယ်လို', 'ဘယ်မှာ', 'ဘယ်က', 'ရမလဲ', 'သလဲ', 'မလဲ', 'ရလား', 'ပါသလား', 'ချင်တယ်', 'လို့ရ', 'လို့'];

/** Weight of a field's terms: what an entry is called counts more than its text. */
const FIELD_WEIGHT = Object.freeze({ title: 3, phrases: 3, text: 1 });
const K1 = 1.2;
const B = 0.75;
/** A prefix match is a weaker match than the word itself. */
const PREFIX_DISCOUNT = 0.6;
/** Below this, nothing answers the question and the guide says so. */
export const MIN_SCORE = 1;

/** Lower case, Latin accents off, Myanmar and every other script's marks kept. */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(LATIN_MARKS, '').toLowerCase().normalize('NFC');
}

/**
 * The terms of a text: words, less the ones that carry nothing, and character
 * pairs for a script without spaces.
 * @returns {string[]}
 */
export function tokens(text) {
  const out = [];
  for (const chunk of fold(text).split(/[^\p{L}\p{N}\p{M}]+/u)) {
    if (!chunk) continue;
    if (UNSPACED.test(chunk)) {
      let run = chunk;
      for (const word of MY_STOP) run = run.split(word).join(' ');
      for (const piece of run.split(' ')) {
        const chars = [...piece];
        if (chars.length === 1) out.push(piece);
        for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1]);
      }
      continue;
    }
    if (STOP.has(chunk)) continue;
    if (chunk.length < 2 && !/\d/.test(chunk)) continue;
    out.push(chunk);
  }
  return out;
}

/**
 * @typedef {{ id: string, title: string, text?: string, phrases?: string[], prior?: number }} Entry
 *          `prior` scales an entry's score: a topic written for the guide is a
 *          better answer than a command whose only text is its name.
 */

/**
 * Build the index once, when the guide opens.
 * @param {Entry[]} entries
 */
export function createIndex(entries) {
  const ids = new Set();
  const docs = entries.map((entry) => {
    if (!entry?.id || !entry.title) throw new Error('guide: an entry needs an id and a title');
    if (ids.has(entry.id)) throw new Error(`guide: duplicate entry "${entry.id}"`);
    ids.add(entry.id);
    const tf = new Map();
    let length = 0;
    const add = (text, weight) => {
      for (const term of tokens(text)) { tf.set(term, (tf.get(term) ?? 0) + weight); length += weight; }
    };
    add(entry.title, FIELD_WEIGHT.title);
    for (const phrase of entry.phrases ?? []) add(phrase, FIELD_WEIGHT.phrases);
    add(entry.text ?? '', FIELD_WEIGHT.text);
    return { entry, tf, length };
  });
  const df = new Map();
  for (const doc of docs) for (const term of doc.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const average = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
  return { docs, df, vocabulary: [...df.keys()], average, size: docs.length };
}

/** The vocabulary terms a query term reaches, each with how strongly. */
function reach(index, term) {
  const found = [];
  if (index.df.has(term)) found.push([term, 1]);
  if ([...term].length >= 4) {
    for (const other of index.vocabulary) {
      if (other === term || [...other].length < 4) continue;
      if (other.startsWith(term) || term.startsWith(other)) found.push([other, PREFIX_DISCOUNT]);
    }
  }
  return found;
}

/**
 * Rank the entries for a question.
 *
 * @param {ReturnType<typeof createIndex>} index
 * @param {string} question
 * @param {{ memory?: Memory, limit?: number }} [options]
 * @returns {{ entry: Entry, score: number, learned: boolean }[]} best first; empty when
 *          nothing reaches MIN_SCORE
 */
export function ask(index, question, { memory = null, limit = 3 } = {}) {
  const terms = [...new Set(tokens(question))];
  if (!terms.length) return [];
  const scores = new Map();
  for (const term of terms) {
    for (const [word, strength] of reach(index, term)) {
      const n = index.df.get(word);
      const idf = Math.log(1 + (index.size - n + 0.5) / (n + 0.5));
      for (const doc of index.docs) {
        const f = doc.tf.get(word);
        if (!f) continue;
        const part = idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.length) / index.average)));
        scores.set(doc, (scores.get(doc) ?? 0) + part * strength);
      }
    }
  }
  const boost = memory ? learnedBoost(memory, terms) : new Map();
  const ranked = [];
  for (const doc of index.docs) {
    const base = (scores.get(doc) ?? 0) * (doc.entry.prior ?? 1);
    const extra = boost.get(doc.entry.id) ?? 0;
    const score = base + extra;
    if (score >= MIN_SCORE) ranked.push({ entry: doc.entry, score, learned: extra > 0 });
  }
  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

// --- memory ---------------------------------------------------------------

/**
 * @typedef {{ v: 1, pairs: { t: string[], id: string, n: number, at: number }[] }} Memory
 *          `t` the question's terms, `id` the entry it was answered by, `n`
 *          how many times (negative for "not this"), `at` when, for the cap.
 */

/** How many question-and-answer pairs are kept; the oldest go first. */
export const MEMORY_CAP = 300;

export const emptyMemory = () => ({ v: 1, pairs: [] });

/**
 * A stored memory, checked. A record from another build, or edited by hand,
 * is read for what is valid in it rather than trusted whole.
 * @returns {Memory}
 */
export function readMemory(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.pairs)) return emptyMemory();
  const pairs = raw.pairs.filter((p) => p && Array.isArray(p.t) && p.t.every((t) => typeof t === 'string')
    && typeof p.id === 'string' && Number.isFinite(p.n) && Number.isFinite(p.at));
  return { v: 1, pairs: pairs.slice(-MEMORY_CAP) };
}

/** Share of terms two questions have in common (Jaccard). */
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const term of left) if (right.has(term)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Questions this close to a remembered one borrow its answer. */
const SIMILAR = 0.5;
/** What one remembered use is worth, against a score of a few points. */
const LEARNED_WEIGHT = 3;

function learnedBoost(memory, terms) {
  const boost = new Map();
  for (const pair of memory.pairs) {
    const similar = overlap(terms, pair.t);
    if (similar < SIMILAR) continue;
    const n = Math.max(-3, Math.min(pair.n, 5));
    boost.set(pair.id, (boost.get(pair.id) ?? 0) + similar * n * LEARNED_WEIGHT);
  }
  return boost;
}

/**
 * Remember that `question` was answered by `id` (delta +1), or was not
 * (delta -1). Returns a new memory; the one passed in is left alone.
 * @returns {Memory}
 */
export function learn(memory, question, id, delta, now = Date.now()) {
  const terms = [...new Set(tokens(question))].sort();
  if (!terms.length || !id || !delta) return memory;
  const key = terms.join(' ');
  const pairs = memory.pairs.filter((p) => !(p.id === id && p.t.join(' ') === key));
  const held = memory.pairs.find((p) => p.id === id && p.t.join(' ') === key);
  const n = (held?.n ?? 0) + delta;
  if (n !== 0) pairs.push({ t: terms, id, n, at: now });
  return { v: 1, pairs: pairs.sort((a, b) => a.at - b.at).slice(-MEMORY_CAP) };
}
