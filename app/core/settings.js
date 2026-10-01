/**
 * Settings: the small amount of state worth keeping between sessions, plus the
 * export/import envelope.
 *
 * The export carries settings, the reader's own notes and bookmarks, and the
 * *list* of offline translations — never the translation data itself (several
 * MB each): import restores state and offers to download the listed
 * translations again.
 */

import { expectArray, expectObject, expectString, fail, isPlainObject } from './errors.js';

export const APP = 'lai-siangtho';
export const SCHEMA = 1;

/** Verse layouts, in the order the status bar steps through them. */
export const VERSE_LAYOUTS = Object.freeze(['paragraph', 'list', 'continuous']);
export const THEMES = Object.freeze(['system', 'dark', 'light']);

/** Reading typography: the limits the reading panel offers. */
export const READING = Object.freeze({
  size: { min: 14, max: 26, step: 1, default: 18 },        // px
  leading: { min: 1.3, max: 2.2, step: 0.02, default: 1.66 },
  measure: { min: 24, max: 60, step: 1, default: 34 },      // characters, 0 = full width
  // The interface's own size, which is not the text's: a reader who wants
  // large scripture does not necessarily want large buttons, and one who finds
  // the labels small may be happy with the text.
  ui: { min: 11, max: 17, step: 1, default: 13 },           // px
});
export const MODES = Object.freeze(['reading', 'source']);
/**
 * Which format the source view shows a chapter in.
 *
 * Markdown is the one that can be edited — the notes under `## Notes` round
 * trip back into the reader's own material — and the rest are a window on what
 * this app would write if asked, which is also the honest demonstration of what
 * it does when it reads somebody else's file.
 */
export const SOURCE_FORMATS = Object.freeze(['markdown', 'native', 'usfm', 'usx', 'osis', 'zefania', 'csv']);

/** Typefaces the scripture can be set in. The interface keeps its own. */
export const READING_FONTS = Object.freeze(['serif', 'sans', 'mono']);

/**
 * The sections of the settings page, in order. Named here rather than in the
 * page because features contribute rows to them and the registry checks the
 * name at startup: a typo is a boot error, not a row nobody ever sees.
 */
export const SETTING_SECTIONS = Object.freeze([
  'appearance',   // theme, accent, the chrome that can be hidden
  'reading',      // layout, sync, Strong's, direction
  'typography',   // the sizes
  'study',        // panes and tools: books, search, notes, plans
  'keys',         // shortcuts
  'storage',      // translations, quota, updates
  'material',     // the reader's own notes and marks, and moving them
]);

/** How many rows a sidebar may be split into. Beyond this nothing is readable. */
export const MAX_ROWS = 4;

/**
 * The interface languages a stored setting may name. The strings live in the
 * shell (app/shell/locales); test/locales.test.js holds the two lists equal.
 */
export const INTERFACE_LOCALES = Object.freeze(['en', 'nb', 'my']);

export const defaultSettings = Object.freeze({
  /** Last translation read, or null before anything is installed. */
  translation: null,
  book: 1,
  chapter: 1,
  /** Translations open in the parallel panes, after the primary one. */
  parallel: Object.freeze([]),
  theme: 'system',
  /** Interface language (INTERFACE_LOCALES), or null to follow the device. */
  locale: null,
  /** Accent colour as #rrggbb, or null for the stylesheet's own. */
  accent: null,
  layout: 'paragraph',
  syncScroll: true,
  alignRows: true,
  /** Chrome the reader can hide. */
  ribbon: true,
  statusBar: true,
  leftSidebar: true,
  rightSidebar: true,
  leftWidth: 264,
  rightWidth: 300,
  /** Reading typography. */
  readingSize: READING.size.default,
  readingLeading: READING.leading.default,
  readingMeasure: READING.measure.default,
  /** Size of the interface's own text, in pixels. */
  uiSize: READING.ui.default,
  /** Reading surface or its source text. */
  mode: 'reading',
  sourceFormat: 'markdown',
  /** Typeface for the scripture itself. */
  readingFont: 'serif',
  /** Reopen last session's tabs, or start on the last passage alone. */
  restoreTabs: true,
  /** Transitions and animations. Off is a setting, not a fault. */
  motion: true,
  /**
   * The ribbon's buttons, by command id, in the order they are drawn. Null
   * means "whatever this build offers" — the commands that asked for a ribbon
   * button, in registration order — which is also what a reset restores. A
   * stored list may name a command this build no longer has; the shell drops
   * those when it draws, rather than the parser refusing the file.
   */
  ribbonItems: null,
  /** Show Strong's numbers where a translation carries them. */
  strongs: false,
  /**
   * Under each verse, the original-language text the reader imported (Hebrew
   * for the Old Testament, Greek for the New), a word at a time, each with its
   * gloss from the lexicon where one is held.
   */
  interlinear: false,
  /**
   * Where sidebars are drawers (a phone, a narrow window), open a pane in a
   * workspace tab instead: a drawer is the wrong shape for a search or a word
   * study. Off by default; a pane can be opened as a tab on any screen.
   */
  paneTabs: false,
  /** Show section headings (the translation's `story` and verse titles). */
  headings: true,
  /** Show the cross-reference lines under the verses that carry them. */
  xrefs: true,
  /**
   * Sidebar arrangement: each side is a list of rows, each row a list of pane
   * ids with the one on show and the row's share of the height. Empty means
   * one row per side, in the order the features registered.
   */
  sidebarLeft: Object.freeze([]),
  sidebarRight: Object.freeze([]),
  /**
   * The panes this reader has already been offered, whether or not they kept
   * them. Without it, a pane switched off is indistinguishable from a pane
   * this build has just added — and the shell places anything it does not
   * recognise, so every hidden pane would come back at the next launch.
   */
  sidebarKnown: Object.freeze([]),
  /** Open tabs, restored next time: [{ kind: 'chapter'|docId, book, chapter }] */
  tabs: Object.freeze([]),
  activeTab: 0,
});

const KEYS = Object.keys(defaultSettings);
const IDENTIFY = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Settings read back from this app's own storage, brought up to the shape this
 * build expects. A key that no longer exists is dropped rather than refused:
 * it is an older version of this app writing, not a hand-edited file, and
 * refusing would leave the reader unable to start. What was dropped is
 * reported, so a silent loss is impossible.
 *
 * Imported files stay strict — they carry a schema number and are someone
 * else's data.
 *
 * @returns {{ raw: object, notes: string[] }}
 */
export function migrateSettings(raw) {
  if (!isPlainObject(raw)) return { raw: {}, notes: [] };
  const out = {};
  const dropped = [];
  for (const [key, value] of Object.entries(raw)) {
    if (KEYS.includes(key)) { out[key] = value; continue; }
    // 26.09.23.3 and earlier kept one flat list of panes per sidebar; a sidebar
    // is now rows of panes, so the old list becomes a single row.
    if (key === 'panesLeft' || key === 'panesRight') {
      const target = key === 'panesLeft' ? 'sidebarLeft' : 'sidebarRight';
      if (Array.isArray(value) && value.length && out[target] === undefined) {
        out[target] = [{ views: value, active: value[0], size: 1 }];
      }
      continue;
    }
    dropped.push(key);
  }
  const notes = dropped.length ? [`settings: dropped ${dropped.length} setting(s) this version no longer has: ${dropped.join(', ')}`] : [];
  return { raw: out, notes };
}

/**
 * Validate and clamp settings against category.json. Unknown keys are an error
 * (they indicate a schema change), out-of-range positions are clamped.
 * @param {unknown} raw
 * @param {{ source: string, category: any }} options
 */
export function parseSettings(raw, { source, category }) {
  expectObject(raw, source, '$');
  for (const key of Object.keys(raw)) {
    if (!KEYS.includes(key)) fail(source, `$.${key}`, `unknown setting (expected ${KEYS.join(', ')})`);
  }

  const translation = raw.translation ?? null;
  if (translation !== null) {
    expectString(translation, source, '$.translation');
    if (!IDENTIFY.test(translation)) fail(source, '$.translation', `invalid identify ${JSON.stringify(translation)}`);
  }

  const bookId = Number.isInteger(raw.book) && category.hasBook(raw.book) ? raw.book : defaultSettings.book;
  const chapters = category.book(bookId).chapters;
  const chapter = Number.isInteger(raw.chapter) ? Math.min(Math.max(raw.chapter, 1), chapters) : defaultSettings.chapter;

  const theme = THEMES.includes(raw.theme) ? raw.theme : defaultSettings.theme;
  // A locale this build does not have follows the device rather than refusing
  // the whole file: a newer build may add one, and the setting is only a choice.
  const locale = INTERFACE_LOCALES.includes(raw.locale) ? raw.locale : null;
  const layout = VERSE_LAYOUTS.includes(raw.layout) ? raw.layout : defaultSettings.layout;
  const accent = raw.accent === undefined || raw.accent === null ? null : expectString(raw.accent, source, '$.accent');
  if (accent !== null && !/^#[0-9a-f]{6}$/i.test(accent)) fail(source, '$.accent', `expected #rrggbb, got ${JSON.stringify(accent)}`);
  const flag = (key) => (typeof raw[key] === 'boolean' ? raw[key] : defaultSettings[key]);
  const mode = MODES.includes(raw.mode) ? raw.mode : defaultSettings.mode;
  const clamp = (value, { min, max }, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback);
  const width = (key, min, max) => clamp(raw[key], { min, max }, defaultSettings[key]);
  const rows = (key) => (raw[key] === undefined ? [] : expectArray(raw[key], source, `$.${key}`))
    .map((row, i) => {
      const p = `$.${key}[${i}]`;
      expectObject(row, source, p);
      const views = expectArray(row.views, source, `${p}.views`)
        .map((id, j) => expectString(id, source, `${p}.views[${j}]`))
        .slice(0, 20);
      const active = row.active === undefined || row.active === null ? null : expectString(row.active, source, `${p}.active`);
      const size = typeof row.size === 'number' && Number.isFinite(row.size) && row.size > 0 ? row.size : 1;
      return Object.freeze({ views: Object.freeze(views), active: views.includes(active) ? active : (views[0] ?? null), size });
    })
    .filter((row) => row.views.length)
    .slice(0, MAX_ROWS);

  const known = (raw.sidebarKnown === undefined ? [] : expectArray(raw.sidebarKnown, source, '$.sidebarKnown'))
    .map((id, i) => expectString(id, source, `$.sidebarKnown[${i}]`))
    .slice(0, 60);

  const tabs = (raw.tabs === undefined ? [] : expectArray(raw.tabs, source, '$.tabs'))
    .map((tab, i) => {
      const p = `$.tabs[${i}]`;
      expectObject(tab, source, p);
      const kind = expectString(tab.kind, source, `${p}.kind`);
      if (kind !== 'chapter') return { kind };
      const b = Number.isInteger(tab.book) && category.hasBook(tab.book) ? tab.book : defaultSettings.book;
      const c = Number.isInteger(tab.chapter) ? Math.min(Math.max(tab.chapter, 1), category.book(b).chapters) : 1;
      return { kind, book: b, chapter: c };
    })
    .slice(0, 20);

  const parallel = (raw.parallel === undefined ? [] : expectArray(raw.parallel, source, '$.parallel'))
    .map((id, i) => {
      expectString(id, source, `$.parallel[${i}]`);
      if (!IDENTIFY.test(id)) fail(source, `$.parallel[${i}]`, `invalid identify ${JSON.stringify(id)}`);
      return id;
    });

  return Object.freeze({
    translation, book: bookId, chapter, parallel: Object.freeze([...new Set(parallel)]),
    theme, locale, accent, layout, syncScroll: flag('syncScroll'), alignRows: flag('alignRows'),
    ribbon: flag('ribbon'), statusBar: flag('statusBar'),
    leftSidebar: flag('leftSidebar'), rightSidebar: flag('rightSidebar'),
    leftWidth: width('leftWidth', 180, 520), rightWidth: width('rightWidth', 200, 560),
    readingSize: clamp(raw.readingSize, READING.size, defaultSettings.readingSize),
    readingLeading: clamp(raw.readingLeading, READING.leading, defaultSettings.readingLeading),
    readingMeasure: clamp(raw.readingMeasure, READING.measure, defaultSettings.readingMeasure),
    uiSize: clamp(raw.uiSize, READING.ui, defaultSettings.uiSize),
    mode, strongs: flag('strongs'), interlinear: flag('interlinear'), paneTabs: flag('paneTabs'), headings: flag('headings'), xrefs: flag('xrefs'),
    sourceFormat: SOURCE_FORMATS.includes(raw.sourceFormat) ? raw.sourceFormat : defaultSettings.sourceFormat,
    readingFont: READING_FONTS.includes(raw.readingFont) ? raw.readingFont : defaultSettings.readingFont,
    restoreTabs: flag('restoreTabs'), motion: flag('motion'),
    ribbonItems: commandList(raw.ribbonItems, source, '$.ribbonItems'),
    sidebarLeft: Object.freeze(rows('sidebarLeft')), sidebarRight: Object.freeze(rows('sidebarRight')),
    sidebarKnown: Object.freeze([...new Set(known)]),
    tabs: Object.freeze(tabs), activeTab: Number.isInteger(raw.activeTab) && raw.activeTab >= 0 ? Math.min(raw.activeTab, Math.max(tabs.length - 1, 0)) : 0,
  });
}

/** A list of command ids, or null for "this build's own". */
function commandList(raw, source, path) {
  if (raw === undefined || raw === null) return null;
  return Object.freeze(expectArray(raw, source, path)
    .map((id, i) => expectString(id, source, `${path}[${i}]`))
    .filter((id, i, all) => all.indexOf(id) === i)
    .slice(0, 40));
}

/**
 * @param {{ settings: object, translations: {identify: string, version: number}[],
 *           catalog: { version: number|null, updated: string|null } | null,
 *           annotations?: { notes: object[], marks: object[] },
 *           records?: Record<string, unknown>, appVersion?: string }} input
 */
export function buildExport({ settings, translations, catalog, annotations, records, appVersion }) {
  return {
    app: APP,
    schema: SCHEMA,
    appVersion: appVersion ?? null,
    exportedAt: new Date().toISOString(),
    settings: { ...settings, parallel: [...settings.parallel] },
    library: {
      catalog: catalog ? { version: catalog.version, updated: catalog.updated } : null,
      translations: translations.map(({ identify, version }) => ({ identify, version })),
    },
    data: {
      notes: annotations?.notes ?? [],
      marks: annotations?.marks ?? [],
      // Feature records (plan progress, board, ink): each feature validates its
      // own on the way back in, so they travel as written.
      records: records ?? {},
    },
  };
}

/**
 * @returns {{ exportedAt: string|null, settings: object,
 *             translations: {identify: string, version: number}[],
 *             catalog: { version: number|null, updated: string|null } | null }}
 */
export function parseExport(raw, { source, category }) {
  expectObject(raw, source, '$');
  if (raw.app !== APP) fail(source, '$.app', `expected "${APP}", got ${JSON.stringify(raw.app ?? null)} — this file is not a Lai Siangtho export`);
  if (raw.schema !== SCHEMA) fail(source, '$.schema', `unsupported export schema ${JSON.stringify(raw.schema ?? null)} (this version reads schema ${SCHEMA})`);

  const settings = parseSettings(raw.settings ?? {}, { source: `${source} settings`, category });
  const library = raw.library === undefined ? {} : expectObject(raw.library, source, '$.library');
  const translations = (library.translations === undefined ? [] : expectArray(library.translations, source, '$.library.translations'))
    .map((t, i) => {
      const p = `$.library.translations[${i}]`;
      expectObject(t, source, p);
      const identify = expectString(t.identify, source, `${p}.identify`);
      if (!IDENTIFY.test(identify)) fail(source, `${p}.identify`, `invalid identify ${JSON.stringify(identify)}`);
      return { identify, version: Number.isInteger(t.version) ? t.version : null };
    });

  const catalog = isPlainObject(library.catalog)
    ? { version: library.catalog.version ?? null, updated: library.catalog.updated ?? null }
    : null;

  // Notes and bookmarks are validated by core/annotations.js when they are
  // merged; here they are only checked for shape, so one bad record cannot
  // block the rest of the import.
  const data = raw.data === undefined ? {} : expectObject(raw.data, source, '$.data');
  const annotations = {
    notes: data.notes === undefined ? [] : expectArray(data.notes, source, '$.data.notes'),
    marks: data.marks === undefined ? [] : expectArray(data.marks, source, '$.data.marks'),
  };

  const records = data.records === undefined ? {} : expectObject(data.records, source, '$.data.records');

  return { exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null, settings, translations, catalog, annotations, records };
}
