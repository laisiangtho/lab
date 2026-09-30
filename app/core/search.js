/**
 * Query matching for scripture text.
 *
 * Three ways to match, and the reader chooses:
 *
 *   terms   Plain words are ANDed; "a phrase" in quotes matches as written.
 *   word    The same, but a term only counts on a word boundary — "man" no
 *           longer matches "manner".
 *   regex   The query is a regular expression, as written.
 *
 * Folding is what makes the first two forgiving. Text and query are folded to
 * NFD with combining marks removed, and offsets are mapped back to the original
 * string so highlighting lands on the right characters. Scripts whose marks
 * carry meaning (Myanmar, Arabic, Hebrew) keep theirs — only Latin-range marks
 * are folded. Case folds too, unless the reader asks for it to matter.
 *
 * A regular expression is matched against the text as written: folding it would
 * change what the pattern means.
 *
 * All three read the plain text — Strong's numbers taken out — so a phrase is
 * found across a tagged word. A query that is one Strong's number instead
 * finds the words tagged with it (`strongsQuery`).
 */

import { codeRanges, normalizeCode } from './strongs.js';

const LATIN_MARKS = /[̀-ͯ]/g;
/**
 * What counts as being inside a word, for whole-word matching. Marks are: a
 * Burmese vowel sign is part of the word it is written on, and without \p{M}
 * a search for the whole word က found it inside ကောင်း.
 */
const WORD = /[\p{L}\p{M}\p{N}_]/u;

export const MATCH_MODES = Object.freeze(['terms', 'word', 'regex']);

/**
 * How one UTF-16 unit folds, remembered: a verse is folded for every search,
 * and calling normalize() for each of its characters was most of the time a
 * search took — about a second a Bible. Scripture uses a few hundred distinct
 * characters, so the tables stay small. One table per case setting.
 */
const FOLDED = [new Map(), new Map()];
const ASCII = /^[\x00-\x7f]*$/;

function foldUnit(unit, matchCase) {
  const table = FOLDED[matchCase ? 1 : 0];
  let out = table.get(unit);
  if (out === undefined) {
    const stripped = unit.normalize('NFD').replace(LATIN_MARKS, '');
    out = matchCase ? stripped : stripped.toLowerCase();
    table.set(unit, out);
  }
  return out;
}

/**
 * The folded text alone, and whether each character folded to exactly one —
 * then an offset in the folded text is the same offset in the original, and
 * no map is needed. Plain ASCII, most of an English Bible, is only lowercased.
 */
function foldFast(text, matchCase) {
  if (ASCII.test(text)) return { folded: matchCase ? text : text.toLowerCase(), aligned: true };
  let folded = '';
  let aligned = true;
  for (let i = 0; i < text.length; i += 1) {
    const unit = foldUnit(text[i], matchCase);
    if (unit.length !== 1) aligned = false;
    folded += unit;
  }
  return { folded, aligned };
}

/** Fold for comparison, and record where each folded character came from. */
function fold(text, matchCase = false) {
  const out = [];
  const map = [];
  for (let i = 0; i < text.length; i += 1) {
    for (const ch of foldUnit(text[i], matchCase)) { out.push(ch); map.push(i); }
  }
  map.push(text.length);
  return { folded: out.join(''), map };
}

export function normalize(text, matchCase = false) {
  return fold(text, matchCase).folded;
}

/**
 * @param {string} query
 * @param {{ mode?: 'terms'|'word'|'regex', matchCase?: boolean }} [options]
 * @returns {{ terms: string[], test(text: string): {start:number,end:number}[] | null } | null}
 *          null when the query has nothing to match
 * @throws {Error} when `mode` is 'regex' and the pattern does not compile
 */
export function createMatcher(query, { mode = 'terms', matchCase = false } = {}) {
  if (!MATCH_MODES.includes(mode)) throw new Error(`search: unknown match mode "${mode}"`);
  if (mode === 'regex') return regexMatcher(query, matchCase);

  const code = strongsQuery(query);
  if (code) return strongsMatcher(code);

  const terms = parseQuery(query, matchCase);
  if (!terms.length) return null;
  const whole = mode === 'word';
  return {
    terms,
    mode,
    /** @returns ranges in the ORIGINAL string, or null when a term is missing */
    test(text) {
      const fast = foldFast(text, matchCase);
      // Most verses miss: find out before building an offset map.
      for (const term of terms) if (!fast.folded.includes(term)) return null;
      const { folded, map } = fast.aligned ? { folded: fast.folded, map: null } : fold(text, matchCase);
      const original = (i) => (map ? map[i] : i);
      const ranges = [];
      for (const term of terms) {
        let from = 0;
        let found = false;
        for (;;) {
          const at = folded.indexOf(term, from);
          if (at === -1) break;
          from = at + term.length;
          if (whole && !onWordBoundary(folded, at, from)) continue;
          ranges.push({ start: original(at), end: original(from) });
          found = true;
        }
        if (!found) return null;
      }
      return ranges.sort((a, b) => a.start - b.start);
    },
  };
}

function onWordBoundary(folded, start, end) {
  const before = start === 0 ? '' : folded[start - 1];
  const after = end >= folded.length ? '' : folded[end];
  return !WORD.test(before || ' ') && !WORD.test(after || ' ');
}

/**
 * The query as a regular expression. An empty pattern matches nothing rather
 * than everything, and a pattern that cannot compile is an error the reader
 * sees — the alternative is a silent scan that finds nothing for no stated
 * reason.
 */
function regexMatcher(query, matchCase) {
  const pattern = query.trim();
  if (!pattern) return null;
  let expression;
  try {
    expression = new RegExp(pattern, `gu${matchCase ? '' : 'i'}`);
  } catch (err) {
    // "Invalid regular expression: /(a/gui: Unterminated group" says the same
    // thing twice and shows flags the reader never typed.
    throw new Error(String(err.message).replace(/^.*?:\s*\/.*?\/[a-z]*:\s*/s, ''));
  }
  return {
    terms: [pattern],
    mode: 'regex',
    test(text) {
      expression.lastIndex = 0;
      const ranges = [];
      for (;;) {
        const match = expression.exec(text);
        if (!match) break;
        // A pattern that can match nothing (`a*`) would otherwise loop for ever.
        if (match[0] === '') { expression.lastIndex += 1; continue; }
        ranges.push({ start: match.index, end: match.index + match[0].length });
        if (ranges.length > 200) break;
      }
      return ranges.length ? ranges : null;
    },
  };
}

/** `love "the world" god` → ['love', 'the world', 'god'] */
export function parseQuery(query, matchCase = false) {
  const terms = [];
  for (const [, quoted, bare] of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = normalize(quoted ?? bare, matchCase).trim();
    if (term) terms.push(term);
  }
  return terms;
}

/**
 * A query that is one Strong's number — `H430`, `g26`, `H1254a` — asks for the
 * words tagged with it, not for the letters: those are not in the plain text
 * at all. A bare number is a verse number or a count far more often than a
 * lexicon entry, so it is searched as text.
 *
 * @returns {string|null} the number, normalised
 */
export function strongsQuery(query) {
  const found = /^\s*([HG])0*(\d{1,5})([a-z]?)\s*$/i.exec(String(query ?? ''));
  return found ? normalizeCode(`${found[1]}${found[2]}${found[3]}`) : null;
}

/**
 * Matches the words carrying one number. It is given the verse as stored —
 * with its markup, the only place the number is — and answers with ranges in
 * the plain text, which is what the result shows. `marked` tells the caller
 * which text to hand it. A number with a sense letter finds only that sense;
 * one without finds every sense of it.
 */
function strongsMatcher(code) {
  const base = code.replace(/[A-Z]$/, '');
  const exact = base !== code;
  return {
    terms: [code],
    mode: 'strongs',
    marked: true,
    test(text) {
      const ranges = codeRanges(text)
        .filter((range) => (exact ? range.code === code : range.code.replace(/[A-Z]$/, '') === base))
        .map(({ from, to }) => ({ start: from, end: to }));
      return ranges.length ? ranges : null;
    },
  };
}

/**
 * A single-line excerpt around the first match.
 * @returns {{ before: string, hit: string, after: string }}
 */
export function snippet(text, ranges, { context = 42 } = {}) {
  const first = ranges[0] ?? { start: 0, end: 0 };
  const from = Math.max(0, first.start - context);
  const to = Math.min(text.length, first.end + context * 2);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, first.start),
    hit: text.slice(first.start, first.end),
    after: text.slice(first.end, to) + (to < text.length ? '…' : ''),
  };
}
