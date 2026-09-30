/**
 * getBible's JSON (api.getbible.net/v2/<abbreviation>.json): one translation,
 * books in canon order.
 *
 *   { translation, abbreviation, lang, language, direction,
 *     books: [{ nr, name, chapters: [{ chapter, verses: [{ verse, text }] }] }] }
 *
 * `nr` is the canon's own book number, 1–66, so books map without a name
 * table. Books past 66 (the deuterocanon some translations carry) have no
 * place in this app's canon and are counted as skipped, not dropped quietly.
 */

/** @returns {number} how sure this is getBible's shape */
export function sniffGetBible(text) {
  const head = String(text ?? '').slice(0, 4000);
  if (!head.trimStart().startsWith('{')) return 0;
  const books = /"books"\s*:\s*\[/.test(head);
  const named = /"translation"\s*:/.test(head) && /"abbreviation"\s*:/.test(head);
  if (books && named) return 0.97;
  return books ? 0.5 : 0;
}

export function fromGetBible(text, { source = 'file' } = {}) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: invalid JSON (${err.message})`);
  }
  if (!json || !Array.isArray(json.books)) throw new Error(`${source}: expected getBible's shape, with a "books" list`);
  const book = {};
  const report = { books: 0, chapters: 0, verses: 0, skipped: 0, format: 'getbible' };
  for (const entry of json.books) {
    const nr = Number(entry?.nr);
    if (!Number.isInteger(nr) || nr < 1 || nr > 66) { report.skipped += 1; continue; }
    const chapter = {};
    for (const ch of entry.chapters ?? []) {
      const c = Number(ch?.chapter);
      if (!Number.isInteger(c) || c < 1) continue;
      const verse = {};
      for (const v of ch.verses ?? []) {
        const n = Number(v?.verse);
        const words = String(v?.text ?? '').replace(/\s+/g, ' ').trim();
        if (!Number.isInteger(n) || n < 1 || !words) continue;
        verse[n] = { text: words };
        report.verses += 1;
      }
      if (Object.keys(verse).length) { chapter[c] = { verse }; report.chapters += 1; }
    }
    if (!Object.keys(chapter).length) continue;
    book[nr] = { info: { name: String(entry.name ?? '').trim() }, chapter };
    report.books += 1;
  }
  if (!report.books) throw new Error(`${source}: no book in this file is one of the 66`);
  const info = {
    name: String(json.translation ?? '').trim(),
    shortname: String(json.abbreviation ?? '').trim().toUpperCase().slice(0, 12),
    language: {
      text: String(json.language ?? '').trim(),
      name: String(json.lang ?? '').trim(),
      textdirection: String(json.direction ?? '').toLowerCase() === 'rtl' ? 'rtl' : 'ltr',
    },
  };
  return { raw: { info, book }, report };
}
