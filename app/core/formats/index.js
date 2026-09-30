/**
 * Reading somebody else's Bible file.
 *
 * The rule that keeps this from becoming a swamp: **an adapter converts, it
 * never validates.** Each one turns a file it recognises into the shape this
 * app already reads, and then `parseTranslation` checks that shape against
 * `category.json` exactly as it checks a file from the catalog. So an imported
 * translation is not a second-class one held to a lower standard — it is the
 * same translation, arrived at differently, with the same versification report
 * at the end of it.
 *
 * The consequence worth stating: an adapter is allowed to be lenient, because
 * nothing it produces is trusted. It may guess a delimiter, ignore a marker it
 * does not know, and drop a footnote. What it may not do is invent a verse.
 *
 * ## Being asked what the file is
 *
 * `sniff` ranks the adapters against the file and the import asks the reader to
 * confirm. That question is not a gate and not a survey: the answer is already
 * filled in, and it exists because a file's extension is a poor witness — `.xml`
 * is three formats, `.txt` is any of them, and a reader who knows their file is
 * a Zefania export can say so in less time than this app would take to work it
 * out wrongly.
 */

import { fromDelimited, sniffDelimiter } from './csv.js';
import { fromUsfm } from './usfm.js';
import { fromXml, sniffXml } from './xml.js';
import { directionOf, languageName } from '../langcode.js';

/**
 * @typedef {{ id: string, ext: string[],
 *             sniff: (text: string, name: string) => number,
 *             convert: (text: string, options: object) => { raw: object, report: object } }} Adapter
 */

/** Our own file: already the right shape, so conversion is a parse. */
const native = {
  id: 'native',
  ext: ['.json'],
  sniff(text) {
    const head = text.slice(0, 2000);
    if (!head.trimStart().startsWith('{')) return 0;
    // The shape's own fingerprints, in the order they are worth anything.
    if (/"identify"\s*:/.test(head) && /"book"\s*:/.test(text.slice(0, 20000))) return 0.95;
    if (/"book"\s*:\s*\{/.test(text.slice(0, 20000))) return 0.6;
    return 0.2;
  },
  convert(text, { source }) {
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`${source}: invalid JSON (${err.message})`);
    }
    // A file exported by this app wraps the translation in an envelope; one
    // downloaded from the catalog is the translation itself.
    const inner = raw?.app === 'lai-siangtho' && raw.kind === 'translation' ? raw.translation : raw;
    return { raw: inner, report: { native: true } };
  },
};

const usfm = {
  id: 'usfm',
  ext: ['.usfm', '.sfm', '.ptx', '.txt'],
  sniff(text) {
    const head = text.slice(0, 4000);
    if (/\\id\s+[A-Z1-9]{3}/.test(head)) return 0.95;
    if (/\\c\s+\d/.test(head) && /\\v\s+\d/.test(text.slice(0, 20000))) return 0.8;
    if (/^\s*\\[a-z]/m.test(head)) return 0.4;
    return 0;
  },
  convert: fromUsfm,
};

const xml = {
  id: 'xml',
  ext: ['.xml', '.osis', '.usfx', '.zef'],
  sniff(text) {
    const kind = sniffXml(text);
    if (kind) return 0.9;
    return text.trimStart().startsWith('<') ? 0.3 : 0;
  },
  convert: fromXml,
};

const delimited = {
  id: 'csv',
  ext: ['.csv', '.tsv', '.txt'],
  sniff(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
    if (lines.length < 2) return 0;
    if (lines[0].trimStart().startsWith('<') || lines[0].trimStart().startsWith('{')) return 0;
    const sep = sniffDelimiter(text);
    const widths = lines.map((line) => line.split(sep).length);
    if (widths[0] < 4) return 0;
    return widths.every((n) => n === widths[0]) ? 0.7 : 0.35;
  },
  convert: fromDelimited,
};

/** Every adapter, in the order they are offered. */
export const FORMATS = Object.freeze([native, usfm, xml, delimited]);

export const formatById = (id) => FORMATS.find((f) => f.id === id) ?? null;

/**
 * What this file probably is, best first.
 *
 * The filename counts for something but not for much — it is a hint from
 * whoever last renamed the file, and the content is the file itself.
 *
 * @returns {{ id: string, confidence: number }[]}
 */
export function sniff(text, name = '') {
  const lower = String(name ?? '').toLowerCase();
  return FORMATS
    .map((format) => {
      let score = 0;
      try {
        score = format.sniff(String(text ?? ''), lower);
      } catch {
        score = 0;
      }
      if (score && format.ext.some((ext) => lower.endsWith(ext))) score = Math.min(1, score + 0.08);
      return { id: format.id, confidence: Number(score.toFixed(2)) };
    })
    .filter((row) => row.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * What a file says about itself, cheaply, for filling in the import dialog.
 *
 * Every field here is a suggestion the reader is looking at and can overwrite,
 * so this reads the first few kilobytes with regular expressions rather than
 * converting the whole file. Being approximately right in a box somebody is
 * about to edit is worth more than being exactly right a minute later.
 *
 * @returns {{ name: string, identify: string, language: string }}
 */
export function describe(text, format, name = '') {
  const head = String(text ?? '').slice(0, 8000);
  const out = { name: '', identify: '', language: '' };
  if (format === 'native') {
    try {
      const info = (JSON.parse(String(text ?? '')) ?? {}).info ?? {};
      out.name = String(info.name ?? '');
      out.identify = String(info.identify ?? '');
      out.language = String(info.language?.iso?.['639-1'] || info.language?.iso?.['639-3'] || info.language?.name || '');
    } catch {
      // Not readable as JSON: the import will say so properly.
    }
  } else if (format === 'usfm') {
    out.identify = (/\\id\s+([A-Z0-9]{3})/i.exec(head)?.[1] ?? '').toLowerCase();
    out.name = /\\(?:toc1|h)\s+(.+)/i.exec(head)?.[1]?.trim() ?? '';
  } else if (format === 'xml') {
    // Zefania names itself in an attribute; OSIS and USFX in a <title> in the
    // header (OSIS: <work><title>), which is the first title in the file.
    out.name = attr(head, 'biblename') || element(head, 'title') || attr(head, 'title') || '';
    out.identify = (attr(head, 'osisidwork') || attr(head, 'id') || '').toLowerCase();
    out.language = attr(head, 'xml:lang') || attr(head, 'lang') || element(head, 'language') || '';
  }
  out.identify = slug(out.identify || name);
  out.name = out.name || '';
  return out;
}

/** The text of the first `<tag>` in the head, entities decoded, on one line. */
const element = (head, tag) => {
  const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]+)</${tag}>`, 'i').exec(head)?.[1] ?? '';
  return found.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
};

const attr = (head, key) => new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, 'i').exec(head)?.[1] ?? '';

/**
 * Convert a file to this app's own shape, ready for `parseTranslation`.
 *
 * `info` is what the reader supplied in the dialog: a name, an identify, a
 * language. It wins over whatever the file said about itself, because the
 * reader is looking at both and the file is not.
 *
 * @param {{ text: string, format: string, source: string, category: object,
 *           info?: object, dialect?: string, delimiter?: string }} job
 */
export function convert({ text, format, source, category, info = {}, ...rest }) {
  const adapter = formatById(format);
  if (!adapter) throw new Error(`${source}: no importer called "${format}"`);
  const { raw, report } = adapter.convert(text, { category, source, ...rest });
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: nothing could be read from this file`);

  const merged = {
    ...raw,
    info: {
      ...(raw.info ?? {}),
      ...clean(info),
    },
  };
  // Everything below is what a file in this app's own format is required to
  // carry and an imported one usually is not. It is filled here rather than in
  // the adapters so that every format arrives with the same gaps closed.
  merged.info.identify = String(merged.info.identify ?? '').trim() || slug(source);
  merged.info.name = String(merged.info.name ?? '').trim() || merged.info.identify;
  merged.info.shortname = String(merged.info.shortname ?? '').trim() || merged.info.identify.toUpperCase().slice(0, 6);
  merged.info.version = merged.info.version ?? 1;
  merged.info.language = languageOf(merged.info.language, info.language);
  merged.version = merged.version ?? merged.info.version;
  merged.identify = merged.info.identify;
  merged.book = namedBooks(merged.book, category);
  return { raw: merged, report: { ...report, format } };
}

/**
 * Every book named, because the app's own format requires it and no other
 * format carries it in a form worth keeping.
 *
 * The canon's English is what goes in, which is honest: the file did not say
 * what it calls Genesis, so neither does this. A language pack supplies the
 * reader's own names at reading time anyway, which is the same route a catalog
 * translation with sparse book info takes.
 */
function namedBooks(books, category) {
  const out = {};
  for (const [key, entry] of Object.entries(books ?? {})) {
    const id = Number(key);
    let canon = null;
    try {
      canon = category.book(id);
    } catch {
      // Not in the canon: left as it is, so the validator refuses it by name
      // rather than this quietly dropping somebody's apocrypha.
      canon = null;
    }
    out[key] = {
      ...entry,
      info: {
        ...(canon ? { name: canon.name, shortname: canon.shortname, abbr: [...canon.abbr] } : {}),
        ...(entry.info ?? {}),
      },
    };
  }
  return out;
}

/** Only the fields the reader actually filled in. */
function clean(info) {
  return Object.fromEntries(Object.entries(info ?? {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
}

/**
 * The language block the app requires, from whatever the file and the reader
 * between them managed to say. A missing direction is `ltr` because that is
 * what the overwhelming majority of files are, and it is one press to change
 * afterwards — the app already lets a reader override direction per
 * translation.
 */
function languageOf(fromFile, fromReader) {
  const given = typeof fromFile === 'object' && fromFile ? fromFile : {};
  const code = String(fromReader ?? given.code ?? given.name ?? (typeof fromFile === 'string' ? fromFile : '')).trim();
  const short = code.length === 2 ? code : '';
  const long = code.length === 3 ? code : '';
  // A direction the file states is kept; otherwise it follows the language,
  // since no OSIS, USFM or Zefania file says which way it is written.
  const stated = given.textdirection === 'rtl' || given.textdirection === 'ltr' ? given.textdirection : null;
  return {
    text: String(given.text ?? '').trim() || (code ? languageName(code, 'en') : '') || 'Unknown',
    name: long || String(given.name ?? '').trim() || code || 'und',
    iso: { '639-1': short || (given.iso?.['639-1'] ?? ''), '639-3': long || (given.iso?.['639-3'] ?? '') },
    textdirection: stated ?? directionOf(code),
  };
}

/** A file name, as an identify: lower case, letters and digits. */
export function slug(name) {
  const base = String(name ?? '').replace(/\.[a-z0-9]+$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'imported';
}
