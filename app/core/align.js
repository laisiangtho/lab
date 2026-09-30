/**
 * Parallel alignment across translations with different verse merges.
 *
 * Each verse covers a span [n, merge ?? n]. Spans from every column are merged
 * where they overlap; each merged group becomes one row. Rows are identical for
 * all columns, so a single grid keeps columns aligned without scroll syncing.
 *
 * Example (Gen 1:17–18): A merges 17–18, B does not.
 *   row { start: 17, end: 18, cells: { A: [17], B: [17, 18] } }
 */

/**
 * @param {Record<string, { merge?: number }>} verses
 * @returns {{ start: number, end: number }[]} sorted by start
 */
export function spansOf(verses) {
  return Object.entries(verses)
    .map(([key, v]) => {
      const start = Number(key);
      return { start, end: v.merge ?? start };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * @param {{ id: string, verses: Record<string, object> | null }[]} columns
 *        `verses: null` means the translation lacks this chapter.
 * @returns {{ start: number, end: number, cells: Record<string, number[]> }[]}
 *        cells[id] lists verse keys (starts) of that column inside the row;
 *        an empty list means the column has nothing for the row.
 */
export function alignChapter(columns) {
  const ids = new Set();
  const all = [];
  for (const { id, verses } of columns) {
    if (ids.has(id)) throw new Error(`alignChapter: duplicate column id ${id}`);
    ids.add(id);
    if (verses) for (const span of spansOf(verses)) all.push({ ...span, id });
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);

  const rows = [];
  let current = null;
  for (const span of all) {
    if (current && span.start <= current.end) {
      current.end = Math.max(current.end, span.end);
      current.cells[span.id].push(span.start);
    } else {
      current = { start: span.start, end: span.end, cells: Object.fromEntries([...ids].map((id) => [id, []])) };
      current.cells[span.id].push(span.start);
      rows.push(current);
    }
  }
  return rows;
}

/** "17" or "17–18" */
export function verseLabel(key, verse) {
  return verse.merge ? `${key}–${verse.merge}` : String(key);
}

/**
 * The verse that carries verse `n` in one translation: the verse itself, or
 * the one whose merge runs over it (17 merged with 18 carries 18).
 *
 * @param {Record<string, { text: string, merge?: number }> | null} verses
 * @param {number} n
 * @returns {{ start: number, end: number, verse: object } | null} null when the
 *          translation has nothing for that verse
 */
export function verseAt(verses, n) {
  if (!verses) return null;
  if (verses[n]) return { start: n, end: Number(verses[n].merge ?? n), verse: verses[n] };
  for (const { start, end } of spansOf(verses)) {
    if (start < n && Number(end) >= n) return { start, end: Number(end), verse: verses[start] };
  }
  return null;
}
