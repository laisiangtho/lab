/**
 * Memory verses: which verses are being learned, when each is next due, and
 * how much of its text to hide when it is practised.
 *
 * ## Spacing
 *
 * Leitner boxes. A verse starts in box 0 and is due at once. "Got it" moves it
 * up a box and schedules it that many days ahead (1, 3, 7, 14, 30, 90); "Hard"
 * keeps it in its box and brings it back in half the time; "Again" sends it to
 * box 0 and brings it back in ten minutes, the same session if the reader is
 * still there. A verse in the last box is counted as learned and still comes
 * back every ninety days. Days are the reader's local days: something due
 * "tomorrow" is due at midnight, not twenty-four hours after it was practised.
 *
 * ## Hiding
 *
 * The box decides how much of the verse is hidden, so practice gets harder as
 * the verse sticks: a third of the words, then half, then only each word's
 * first letter, then nothing. Which words go is fixed per verse (seeded by its
 * reference), so the same verse is hidden the same way from one day to the
 * next rather than a different puzzle each time.
 *
 * Words are what a reader would call words. Burmese writes none apart, so a
 * run of Myanmar script is cut into syllables — a consonant starts a new
 * syllable unless it is stacked under the one before (after ္) or killed by
 * an asat (်) — which is the unit a reader of Burmese learns by.
 */

/** Days until next due, per box after a "Got it". */
export const INTERVALS = Object.freeze([0, 1, 3, 7, 14, 30, 90]);
export const LAST_BOX = INTERVALS.length - 1;
/** A verse in this box or higher counts as learned. */
export const LEARNED_BOX = 4;
const AGAIN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GRADES = Object.freeze(['again', 'hard', 'good']);

/** "19.23.1" — a card's id, one per starting verse. */
export const cardId = (book, chapter, verse) => `${book}.${chapter}.${verse}`;

/** Local midnight at the start of the day `days` from the day of `now`. */
function dayStart(now, days = 0) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/**
 * A new card, due at once.
 * @param {{ book: number, chapter: number, verse: number, to?: number|null, identify?: string|null }} passage
 */
export function newCard({ book, chapter, verse, to = null, identify = null }, now = Date.now()) {
  for (const [name, value] of [['book', book], ['chapter', chapter], ['verse', verse]]) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`memory: ${name} must be a positive whole number, got ${JSON.stringify(value)}`);
  }
  if (to !== null && (!Number.isInteger(to) || to < verse)) throw new Error(`memory: the last verse must come at or after ${verse}, got ${JSON.stringify(to)}`);
  return {
    id: cardId(book, chapter, verse), book, chapter, verse, to: to && to !== verse ? to : null,
    identify, added: now, box: 0, due: now, reps: 0, lapses: 0, last: null,
  };
}

/**
 * A card after one practice.
 * @param {'again'|'hard'|'good'} grade
 */
export function review(card, grade, now = Date.now()) {
  if (!GRADES.includes(grade)) throw new Error(`memory: grade must be one of ${GRADES.join(', ')}, got ${JSON.stringify(grade)}`);
  const next = { ...card, reps: card.reps + 1, last: now };
  if (grade === 'again') {
    next.box = 0;
    next.lapses = card.lapses + 1;
    next.due = now + AGAIN_MS;
  } else if (grade === 'hard') {
    const days = Math.max(1, Math.round(INTERVALS[card.box] / 2));
    next.due = dayStart(now, days);
  } else {
    next.box = Math.min(card.box + 1, LAST_BOX);
    next.due = dayStart(now, INTERVALS[next.box]);
  }
  return next;
}

/** The cards due now, the most overdue first. */
export function dueCards(cards, now = Date.now()) {
  return cards.filter((card) => card.due <= now).sort((a, b) => a.due - b.due || a.added - b.added);
}

/** How the set stands: how many, how many due, how many learned, when the next one is. */
export function summary(cards, now = Date.now()) {
  const due = dueCards(cards, now).length;
  const learned = cards.filter((card) => card.box >= LEARNED_BOX).length;
  const later = cards.filter((card) => card.due > now).map((card) => card.due);
  return { total: cards.length, due, learned, next: later.length ? Math.min(...later) : null };
}

/**
 * The stored record, checked. Cards that do not read as cards are left out
 * rather than trusted: the record may have come from an import.
 */
export function readCards(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.cards)) return [];
  const seen = new Set();
  const out = [];
  for (const card of raw.cards) {
    const whole = (n) => Number.isInteger(n) && n >= 1;
    if (!card || !whole(card.book) || !whole(card.chapter) || !whole(card.verse)) continue;
    if (!Number.isFinite(card.due) || !Number.isInteger(card.box) || card.box < 0 || card.box > LAST_BOX) continue;
    const id = cardId(card.book, card.chapter, card.verse);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id, book: card.book, chapter: card.chapter, verse: card.verse,
      to: whole(card.to) && card.to > card.verse ? card.to : null,
      identify: typeof card.identify === 'string' ? card.identify : null,
      added: Number.isFinite(card.added) ? card.added : card.due,
      box: card.box, due: card.due,
      reps: Number.isInteger(card.reps) ? card.reps : 0,
      lapses: Number.isInteger(card.lapses) ? card.lapses : 0,
      last: Number.isFinite(card.last) ? card.last : null,
    });
  }
  return out;
}

export const writeCards = (cards) => ({ v: 1, cards });

// --- hiding ---------------------------------------------------------------

const MYANMAR = /[က-႟]/;
/**
 * Where a Myanmar syllable starts: a consonant (or independent vowel, digit
 * or sign) not stacked under the one before and not killed by an asat after.
 */
const SYLLABLE_START = /(?<!္)(?=[က-ဪဿ၀-၉၌-၏](?![္်]))/u;

/**
 * The text as words and the spaces and marks between them.
 * @returns {{ text: string, word: boolean }[]}
 */
export function words(text) {
  const out = [];
  for (const part of String(text ?? '').split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { out.push({ text: part, word: false }); continue; }
    const pieces = MYANMAR.test(part) ? part.split(SYLLABLE_START).filter(Boolean) : [part];
    for (const piece of pieces) {
      // Punctuation round a word stays in sight: hiding "Lord," hides "Lord".
      const found = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}\p{M}]*)$/su.exec(piece);
      const [, before, core, after] = found;
      if (before) out.push({ text: before, word: false });
      if (core) out.push({ text: core, word: true });
      if (after) out.push({ text: after, word: false });
    }
  }
  return out;
}

/** How much a box hides: a share of the words, or every word to its first letter. */
export function levelOf(box) {
  return ['third', 'half', 'initials', 'initials', 'all', 'all', 'all'][Math.max(0, Math.min(box, LAST_BOX))];
}

/** A small, fixed pseudo-random sequence from a string (FNV-1a, then xorshift). */
function sequence(seed) {
  let x = 2166136261;
  for (const ch of seed) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; }
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/**
 * The verse as it is shown for practice.
 *
 * @param {string} text
 * @param {'none'|'third'|'half'|'initials'|'all'} level
 * @param {string} seed the card's id, so the same words go each time
 * @returns {{ text: string, word: boolean, hidden: boolean, hint: string }[]}
 *          `hint` is what shows in place of a hidden word: its first letter
 *          at the `initials` level, nothing otherwise
 */
export function mask(text, level, seed) {
  const parts = words(text);
  const indexes = parts.map((part, i) => (part.word ? i : -1)).filter((i) => i >= 0);
  const hide = new Set();
  if (level === 'initials' || level === 'all') for (const i of indexes) hide.add(i);
  else if (level === 'third' || level === 'half') {
    const share = level === 'third' ? 1 / 3 : 1 / 2;
    const next = sequence(seed);
    const order = indexes.map((i) => [next(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    for (const i of order.slice(0, Math.max(1, Math.round(indexes.length * share)))) hide.add(i);
  } else if (level !== 'none') throw new Error(`memory: unknown level ${JSON.stringify(level)}`);
  return parts.map((part, i) => ({
    ...part,
    hidden: hide.has(i),
    hint: hide.has(i) && level === 'initials' ? [...part.text][0] : '',
  }));
}
