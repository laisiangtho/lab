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
 */

const LATIN_MARKS = /[̀-ͯ]/g;
/** What counts as being inside a word, for whole-word matching. */
const WORD = /[\p{L}\p{N}_]/u;

export const MATCH_MODES = Object.freeze(['terms', 'word', 'regex']);

/** Fold for comparison, and record where each folded character came from. */
function fold(text, matchCase = false) {
  const out = [];
  const map = [];
  for (let i = 0; i < text.length; i += 1) {
    const stripped = text[i].normalize('NFD').replace(LATIN_MARKS, '');
    const decomposed = matchCase ? stripped : stripped.toLowerCase();
    for (const ch of decomposed) { out.push(ch); map.push(i); }
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

  const terms = parseQuery(query, matchCase);
  if (!terms.length) return null;
  const whole = mode === 'word';
  return {
    terms,
    mode,
    /** @returns ranges in the ORIGINAL string, or null when a term is missing */
    test(text) {
      const { folded, map } = fold(text, matchCase);
      const ranges = [];
      for (const term of terms) {
        let from = 0;
        let found = false;
        for (;;) {
          const at = folded.indexOf(term, from);
          if (at === -1) break;
          from = at + term.length;
          if (whole && !onWordBoundary(folded, at, from)) continue;
          ranges.push({ start: map[at], end: map[from] });
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
