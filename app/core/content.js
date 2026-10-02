/**
 * What a translation carries, in a few figures a reader can decide by:
 * which testaments, how many verses, and whether it has Strong's numbers,
 * cross-references, section headings and verse titles.
 *
 *   { ot, nt, verses, strongs, refs, headings, titles }
 *
 *   ot, nt     books of each testament it has
 *   verses     verses it has
 *   strongs    words tagged with a Strong's number (0: none)
 *   refs       verses with cross-references
 *   headings   section headings (the file's `story`)
 *   titles     verse titles (a psalm's superscription)
 *   faults     optional: faults in the file the app reads past, by kind
 *              (core/translation.js FAULTS), so a reader is told before
 *              downloading what to expect
 *
 * The same figures come from two places: a parsed translation
 * (`contentOf`, at install, and in scripts/catalog-content.mjs, which
 * writes them into the catalog's book.json as each entry's `content`), and
 * the catalog itself (`readContent`), so a translation not yet downloaded
 * can say what it has. An entry without `content` says nothing, as before.
 *
 * Pure.
 */

import { fail, isPlainObject } from './errors.js';
import { FAULTS, faultsOf } from './translation.js';

export const CONTENT_KEYS = Object.freeze(['ot', 'nt', 'verses', 'strongs', 'refs', 'headings', 'titles']);

/**
 * @param {{ meta: { books: object, story?: object }, stats: object }} parsed
 *        what parseTranslation returns, or a stored translation's meta with
 *        its stats (`{ meta, stats }`)
 * @param {{ book(id: number): { testament: number } }} category
 */
export function contentOf({ meta, stats, diagnostics }, category) {
  const faults = faultsOf(diagnostics);
  const books = Object.keys(meta?.books ?? {}).map(Number);
  const testament = (id) => category.book(id).testament;
  let headings = 0;
  for (const chapters of Object.values(meta?.story ?? {})) {
    for (const verses of Object.values(chapters ?? {})) headings += Object.keys(verses ?? {}).length;
  }
  return Object.freeze({
    ot: books.filter((id) => testament(id) === 1).length,
    nt: books.filter((id) => testament(id) === 2).length,
    verses: stats?.verses ?? 0,
    strongs: stats?.strongs?.words ?? 0,
    refs: stats?.refs ?? 0,
    headings,
    titles: stats?.titles ?? 0,
    ...(Object.keys(faults).length ? { faults: Object.freeze(faults) } : {}),
  });
}

/**
 * A catalog entry's `content`, checked: absent is null; present must be
 * every key, each a whole number not below zero.
 */
export function readContent(raw, source, path) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) fail(source, path, 'expected an object of counts');
  const out = {};
  for (const key of CONTENT_KEYS) {
    const value = raw[key];
    if (!Number.isInteger(value) || value < 0) fail(source, `${path}.${key}`, `expected a whole number, got ${JSON.stringify(value)}`);
    out[key] = value;
  }
  if (raw.faults !== undefined) {
    if (!isPlainObject(raw.faults)) fail(source, `${path}.faults`, 'expected an object of counts by kind');
    const faults = {};
    for (const [kind, n] of Object.entries(raw.faults)) {
      if (!FAULTS.includes(kind)) fail(source, `${path}.faults.${kind}`, `expected one of ${FAULTS.join(', ')}`);
      if (!Number.isInteger(n) || n < 1) fail(source, `${path}.faults.${kind}`, `expected a whole number above zero, got ${JSON.stringify(n)}`);
      faults[kind] = n;
    }
    if (Object.keys(faults).length) out.faults = Object.freeze(faults);
  }
  return Object.freeze(out);
}

/**
 * The features worth naming, in order: what a reader looking for a study
 * Bible, or a plain one, scans for. Each is { id, n }; only what is there.
 * Section headings and verse titles are one feature to a reader — a line in
 * the text that is not scripture — and are counted together.
 */
export function featuresOf(content) {
  if (!content) return [];
  const testaments = content.ot && content.nt ? 'bible' : content.nt ? 'nt' : content.ot ? 'ot' : null;
  return [
    testaments ? { id: testaments, n: content.ot + content.nt } : null,
    content.strongs ? { id: 'strongs', n: content.strongs } : null,
    content.refs ? { id: 'refs', n: content.refs } : null,
    content.headings + content.titles ? { id: 'headings', n: content.headings + content.titles } : null,
  ].filter(Boolean);
}

/**
 * What a translation on this device carries, from what was counted when it
 * was installed (its `stats`); null when nothing was counted. Section
 * headings are not in the stored counts, so verse titles stand for them.
 */
export function contentOfStats(stats, books = null) {
  if (!stats) return null;
  return Object.freeze({
    ot: books?.ot ?? 0, nt: books?.nt ?? 0, verses: stats.verses ?? 0,
    strongs: stats.strongs?.words ?? 0, refs: stats.refs ?? 0, headings: 0, titles: stats.titles ?? 0,
  });
}
