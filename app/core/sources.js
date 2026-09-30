/**
 * Where translations can come from besides the Lai Siangtho catalog, read into
 * one shape so the Library lists them the same way.
 *
 *   getBible    api.getbible.net/v2/translations.json — an object keyed by
 *               abbreviation; each translation is one JSON file
 *   eBible.org  ebible.org/Scriptures/translations.csv — one row per
 *               translation; each is a zip (<id>_usfx.zip) the pack importer
 *               already reads
 *
 * A row: { source, id, name, shortname, language: { name, code }, direction,
 *          license, year, url, kind: 'getbible'|'zip', identify }
 *
 * `identify` is what the translation will be called on this device — the
 * source's own id, prefixed so two sources never collide ("gb-kjv", "eb-engkjv").
 *
 * ## "Already here"
 *
 * The point of listing several sources side by side is that the same Bible is
 * in more than one of them. `onDevice` answers two questions for a row: is
 * this exact one here (same identify), and is the same translation here from
 * somewhere else (same language and the same name once case, punctuation and
 * a trailing year are set aside). The Library marks both, so nobody downloads
 * the King James Version three times by accident.
 */

import { splitRow } from './formats/csv.js';
import { twoLetter } from './langcode.js';

export const SOURCES = Object.freeze(['catalog', 'getbible', 'ebible']);

/** @returns {object[]} rows, sorted by language then name */
export function readGetBibleList(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('getBible: the translation list is not an object keyed by abbreviation');
  const rows = [];
  for (const [key, item] of Object.entries(json)) {
    if (!item || typeof item !== 'object' || !item.url) continue;
    const abbreviation = String(item.abbreviation ?? key).trim();
    rows.push({
      source: 'getbible',
      id: abbreviation,
      identify: `gb-${slugOf(abbreviation)}`,
      name: String(item.translation ?? abbreviation).trim(),
      shortname: abbreviation.toUpperCase(),
      language: { name: String(item.language ?? '').trim(), code: String(item.lang ?? '').trim() },
      direction: String(item.direction ?? '').toLowerCase() === 'rtl' ? 'rtl' : 'ltr',
      license: String(item.distribution_license ?? '').trim(),
      year: String(item.distribution_version_date ?? '').trim(),
      url: String(item.url),
      kind: 'getbible',
    });
  }
  if (!rows.length) throw new Error('getBible: the translation list is empty');
  return sorted(rows);
}

/**
 * eBible.org's translations.csv. Columns are found by name, so a reordered
 * file still reads; the three this cannot do without are named when missing.
 * Only translations eBible.org marks as redistributable are listed.
 */
export function readEbibleCsv(text, { base = 'https://ebible.org/Scriptures/' } = {}) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('eBible.org: the translation list is empty');
  const head = splitRow(lines[0], ',').map((cell) => cell.trim());
  const col = (name) => head.findIndex((cell) => cell.toLowerCase() === name.toLowerCase());
  const need = { id: col('translationId'), code: col('languageCode'), title: col('title') };
  const missing = Object.entries(need).filter(([, i]) => i < 0).map(([name]) => ({ id: 'translationId', code: 'languageCode', title: 'title' }[name]));
  if (missing.length) throw new Error(`eBible.org: the translation list has no ${missing.join(', ')} column`);
  const opt = {
    short: col('shortTitle'), lang: col('languageNameInEnglish'), native: col('languageName'),
    free: col('Redistributable'), copyright: col('Copyright'), date: col('UpdateDate'),
    direction: col('textDirection'), downloadable: col('downloadable'),
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line, ',');
    const cell = (i) => (i >= 0 ? String(cells[i] ?? '').trim() : '');
    const id = cell(need.id);
    if (!id) continue;
    if (opt.free >= 0 && !/^(true|yes|1)$/i.test(cell(opt.free))) continue;
    if (opt.downloadable >= 0 && /^(false|no|0)$/i.test(cell(opt.downloadable))) continue;
    rows.push({
      source: 'ebible',
      id,
      identify: `eb-${slugOf(id)}`,
      name: cell(need.title) || id,
      shortname: (cell(opt.short) || id).slice(0, 24),
      language: { name: cell(opt.lang) || cell(opt.native) || cell(need.code), code: cell(need.code) },
      direction: /rtl/i.test(cell(opt.direction)) ? 'rtl' : 'ltr',
      license: cell(opt.copyright),
      year: cell(opt.date).slice(0, 4),
      url: `${base}${encodeURIComponent(id)}_usfx.zip`,
      kind: 'zip',
    });
  }
  if (!rows.length) throw new Error('eBible.org: no redistributable translation in the list');
  return sorted(rows);
}

/**
 * Whether a listed translation is on this device already.
 *
 * @param {object} row a source row
 * @param {{ identify: string, info?: object }[]} held what the store lists
 * @returns {{ exact: boolean, same: object|null }} `same` is a held
 *          translation that is this one under another name — from another
 *          source or the catalog
 */
export function onDevice(row, held) {
  if (held.some((h) => h.identify === row.identify)) return { exact: true, same: null };
  const name = normalName(row.name);
  const lang = languageKey(row.language?.code);
  const same = held.find((h) => normalName(h.info?.name) === name && languageKey(h.info?.language?.iso?.['639-1'] || h.info?.language?.name) === lang)
    ?? null;
  return { exact: false, same };
}

/** "The King James Version (1611)" and "King James version" are one name. */
export function normalName(name) {
  return String(name ?? '').toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(1[5-9]|20)\d{2}\b/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const languageKey = (code) => twoLetter(code) ?? String(code ?? '').toLowerCase();

const slugOf = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'x';

const sorted = (rows) => rows.sort((a, b) => a.language.name.localeCompare(b.language.name) || a.name.localeCompare(b.name));
