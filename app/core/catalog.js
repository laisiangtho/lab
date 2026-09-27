/**
 * book.json — the catalog of translations.
 *
 * Two shapes exist and both are accepted explicitly:
 *   remote  { name, updated, version, book: [...], collection }   (authoritative)
 *   legacy  [ ... ]                                               (bundled seed)
 * Only `book[]` is app content; `updated` and `version` drive change detection.
 */

import {
  expectArray, expectObject, expectString, fail, isPlainObject, normalizeVersion, optionalString,
} from './errors.js';

const IDENTIFY = /^[a-z0-9][a-z0-9_-]*$/i;
const DIRECTIONS = new Set(['ltr', 'rtl']);

/**
 * @typedef {object} CatalogEntry
 * @property {string} identify   also the translation file name: json/{identify}.json
 * @property {string} name
 * @property {string} shortname
 * @property {string} year
 * @property {{ text: string, name: string, textdirection: 'ltr'|'rtl' }} language
 * @property {number} version
 * @property {string} description
 * @property {string} publisher
 * @property {string} copyright
 */

/**
 * @param {unknown} raw
 * @param {{ source: string, requireRemoteShape?: boolean }} options
 */
export function parseCatalog(raw, { source, requireRemoteShape = false }) {
  let shape;
  let list;
  let meta = { name: null, updated: null, version: null };

  if (Array.isArray(raw)) {
    if (requireRemoteShape) fail(source, '$', 'expected remote catalog object { name, updated, version, book }, got legacy array');
    shape = 'legacy';
    list = raw;
  } else if (isPlainObject(raw)) {
    shape = 'remote';
    list = expectArray(raw.book, source, '$.book');
    const updated = expectString(raw.updated, source, '$.updated');
    if (Number.isNaN(Date.parse(updated))) fail(source, '$.updated', `not an ISO date: ${updated}`);
    meta = {
      name: optionalString(raw.name, source, '$.name') ?? null,
      updated,
      version: normalizeVersion(raw.version, source, '$.version'),
    };
  } else {
    fail(source, '$', 'expected catalog object or array');
  }

  const seen = new Set();
  const base = shape === 'remote' ? '$.book' : '$';
  const entries = list.map((e, i) => {
    const p = `${base}[${i}]`;
    expectObject(e, source, p);
    const identify = expectString(e.identify, source, `${p}.identify`);
    if (!IDENTIFY.test(identify)) fail(source, `${p}.identify`, `invalid identify ${JSON.stringify(identify)}`);
    if (seen.has(identify)) fail(source, `${p}.identify`, `duplicate identify ${identify}`);
    seen.add(identify);

    const lang = expectObject(e.language, source, `${p}.language`);
    const textdirection = expectString(lang.textdirection, source, `${p}.language.textdirection`);
    if (!DIRECTIONS.has(textdirection)) fail(source, `${p}.language.textdirection`, `expected ltr or rtl, got ${textdirection}`);

    return Object.freeze({
      identify,
      name: expectString(e.name, source, `${p}.name`),
      shortname: optionalString(e.shortname, source, `${p}.shortname`) ?? identify,
      year: optionalString(e.year, source, `${p}.year`) ?? '',
      language: Object.freeze({
        text: expectString(lang.text, source, `${p}.language.text`),
        name: expectString(lang.name, source, `${p}.language.name`),
        textdirection,
      }),
      version: normalizeVersion(e.version, source, `${p}.version`),
      description: optionalString(e.description, source, `${p}.description`) ?? '',
      publisher: optionalString(e.publisher, source, `${p}.publisher`) ?? '',
      copyright: optionalString(e.copyright, source, `${p}.copyright`) ?? '',
    });
  });

  const byId = new Map(entries.map((e) => [e.identify, e]));
  return Object.freeze({
    shape,
    source,
    ...meta,
    entries: Object.freeze(entries),
    get: (identify) => byId.get(identify),
  });
}

/**
 * Relative order of two catalogs. A legacy catalog has no version and is
 * always older than a remote one.
 * @returns {'newer'|'same'|'older'} how `candidate` relates to `current`
 */
export function compareCatalogs(current, candidate) {
  if (candidate.version === null) throw new Error('compareCatalogs: candidate catalog has no version (legacy shape)');
  if (current === null || current.version === null) return 'newer';
  if (candidate.version !== current.version) return candidate.version > current.version ? 'newer' : 'older';
  const a = Date.parse(current.updated);
  const b = Date.parse(candidate.updated);
  if (a === b) return 'same';
  return b > a ? 'newer' : 'older';
}

/**
 * Merge catalog entries with installed translations.
 * @param {ReturnType<typeof parseCatalog>} catalog
 * @param {{ identify: string, version: number }[]} installed
 * A translation the reader imported themselves is `local`, not `unlisted`.
 * Both are installed and absent from the catalog, but they are opposite
 * situations: one was brought in on purpose and the other has been dropped by
 * whoever publishes it, and telling somebody their own file is "no longer
 * listed" reads as an accusation about a file they made.
 *
 * @returns {{ identify: string, entry: CatalogEntry|null, installedVersion: number|null,
 *            state: 'available'|'installed'|'update'|'unlisted'|'local' }[]}
 */
export function translationStatus(catalog, installed) {
  const local = new Map(installed.map((t) => [t.identify, t]));
  const rows = catalog.entries.map((entry) => {
    const held = local.get(entry.identify) ?? null;
    let state = 'available';
    if (held) state = entry.version > held.version ? 'update' : 'installed';
    return { identify: entry.identify, entry, installedVersion: held?.version ?? null, held, state };
  });
  for (const [identify, held] of local) {
    if (!catalog.get(identify)) {
      rows.push({
        identify, entry: null, installedVersion: held.version, held,
        state: held.source ? 'local' : 'unlisted',
      });
    }
  }
  return rows;
}
