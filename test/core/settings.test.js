import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildExport, defaultSettings, migrateSettings, parseExport, parseSettings } from '../../app/core/settings.js';
import { category } from '../helpers.js';

const opts = { source: 'settings', category };

test('defaults round-trip', () => {
  assert.deepEqual(parseSettings({ ...defaultSettings }, opts), defaultSettings);
});

test('out-of-range positions clamp, duplicates collapse', () => {
  assert.deepEqual(parseSettings({ book: 1, chapter: 999, parallel: ['a', 'a', 'b'] }, opts),
    { ...defaultSettings, book: 1, chapter: 50, parallel: ['a', 'b'] });
  assert.equal(parseSettings({ book: 999, chapter: 3 }, opts).book, 1);
});

test('presentation settings validate, unknown values fall back to defaults', () => {
  assert.equal(parseSettings({ theme: 'light' }, opts).theme, 'light');
  assert.equal(parseSettings({ theme: 'neon' }, opts).theme, 'system');
  assert.equal(parseSettings({ layout: 'list' }, opts).layout, 'list');
  assert.equal(parseSettings({ syncScroll: false }, opts).syncScroll, false);
  assert.equal(parseSettings({ accent: '#0ea5e9' }, opts).accent, '#0ea5e9');
  assert.throws(() => parseSettings({ accent: 'blue' }, opts), /\$\.accent: expected #rrggbb/);
});

test('unknown key and malformed identify are errors', () => {
  assert.throws(() => parseSettings({ zoom: 2 }, opts), /\$\.zoom: unknown setting/);
  assert.throws(() => parseSettings({ translation: '../etc' }, opts), /\$\.translation: invalid identify/);
});

test('export carries settings and the translation list, not the text', () => {
  const data = buildExport({
    settings: parseSettings({ translation: 'tedim1932', book: 43, chapter: 7, parallel: ['niv2011'] }, opts),
    translations: [{ identify: 'tedim1932', version: 3, info: { name: 'Lai Siangtho' }, bytes: 5194872 }],
    catalog: { version: 260, updated: '2024-11-18T15:04:44.891Z' },
  });
  assert.deepEqual(data.library.translations, [{ identify: 'tedim1932', version: 3 }]);
  assert.equal(JSON.stringify(data).includes('bytes'), false);

  const back = parseExport(JSON.parse(JSON.stringify(data)), { source: 'export.json', category });
  assert.deepEqual(back.settings, { ...defaultSettings, translation: 'tedim1932', book: 43, chapter: 7, parallel: ['niv2011'] });
  assert.equal(back.catalog.version, 260);
});

test('foreign or future files are refused with a clear message', () => {
  assert.throws(() => parseExport({ app: 'other', schema: 1 }, { source: 'x.json', category }),
    /x\.json: \$\.app: expected "lai-siangtho".*not a Lai Siangtho export/s);
  assert.throws(() => parseExport({ app: 'lai-siangtho', schema: 2 }, { source: 'x.json', category }),
    /unsupported export schema 2 \(this version reads schema 1\)/);
});

test('sidebar rows validate, and an empty row is dropped', () => {
  const rows = [{ views: ['files', 'search'], active: 'search', size: 2 }, { views: [], active: null, size: 1 }];
  const out = parseSettings({ sidebarLeft: rows }, opts);
  assert.equal(out.sidebarLeft.length, 1);
  assert.deepEqual([...out.sidebarLeft[0].views], ['files', 'search']);
  assert.equal(out.sidebarLeft[0].active, 'search');
  assert.equal(out.sidebarLeft[0].size, 2);
});

test('the panes a reader has been offered survive, deduplicated', () => {
  const out = parseSettings({ sidebarKnown: ['files', 'search', 'files'] }, opts);
  assert.deepEqual([...out.sidebarKnown], ['files', 'search']);
  // Settings written before this version have no such list, and the reader has
  // been offered nothing: every pane is new to them, which is what puts the
  // whole sidebar where it has always been.
  assert.deepEqual([...parseSettings({ book: 1 }, opts).sidebarKnown], []);
  assert.throws(() => parseSettings({ sidebarKnown: [7] }, opts), /\$\.sidebarKnown\[0\]/);
});

test('a row whose active pane is not in it falls back to the first', () => {
  const out = parseSettings({ sidebarRight: [{ views: ['notes'], active: 'gone', size: 1 }] }, opts);
  assert.equal(out.sidebarRight[0].active, 'notes');
});

test('stored settings migrate: the old flat pane lists become one row per side', () => {
  const { raw, notes } = migrateSettings({ book: 2, panesLeft: ['files', 'tags'], panesRight: ['notes'] });
  assert.deepEqual(raw.sidebarLeft, [{ views: ['files', 'tags'], active: 'files', size: 1 }]);
  assert.deepEqual(raw.sidebarRight, [{ views: ['notes'], active: 'notes', size: 1 }]);
  assert.equal(raw.book, 2);
  assert.equal(notes.length, 0);
  assert.equal(parseSettings(raw, opts).sidebarLeft.length, 1);
});

test('a setting this version no longer has is dropped and reported, not refused', () => {
  const { raw, notes } = migrateSettings({ chapter: 3, gone: true });
  assert.deepEqual(raw, { chapter: 3 });
  assert.match(notes[0], /gone/);
  assert.throws(() => parseSettings({ chapter: 3, gone: true }, opts), /unknown setting/);
});
