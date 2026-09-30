/**
 * Guide data: the schema.org FAQPage files the guide downloads, and the update
 * that fetches only what changed. The repository is faked; nothing leaves the
 * machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionOf, guidePaths, parseGuideFile, strayPaths } from '../app/core/guidedata.js';
import { createGuideData } from '../app/services/guidedata.js';

const page = (overrides = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  name: 'Bookmarks',
  inLanguage: 'en',
  mainEntity: [{
    '@type': 'Question',
    name: 'How do I bookmark a verse?',
    alternateName: ['mark a verse'],
    acceptedAnswer: { '@type': 'Answer', text: 'Press the verse number.' },
    potentialAction: { '@type': 'Action', target: 'laisiangtho:pane/marks' },
  }],
  ...overrides,
});

test('a FAQPage file becomes guide entries', () => {
  const parsed = parseGuideFile(page(), 'guide/en/help/bookmarks.json');
  assert.equal(parsed.topic, 'Bookmarks');
  assert.equal(parsed.lang, 'en');
  assert.deepEqual(parsed.entries[0], {
    id: 'data:en/help/bookmarks#1', title: 'How do I bookmark a verse?', text: 'Press the verse number.',
    phrases: ['Bookmarks', 'mark a verse'], does: { pane: 'marks' }, topic: 'Bookmarks', lang: 'en', must: [],
  });
  assert.deepEqual(parseGuideFile(page({ name: '1 John' }), 'guide/en/books/62-1-john.json').entries[0].must, ['1']);
});

test('what is wrong with a file is said, with where', () => {
  const at = 'guide/en/help/x.json';
  assert.throws(() => parseGuideFile([], at), /guide\/en\/help\/x.json: expected a JSON object/);
  assert.throws(() => parseGuideFile(page({ '@type': 'Article' }), at), /expected "@type": "FAQPage"/);
  assert.throws(() => parseGuideFile(page({ '@context': 'https://example.org' }), at), /"@context": "https:\/\/schema.org"/);
  assert.throws(() => parseGuideFile(page({ name: '' }), at), /needs a "name"/);
  assert.throws(() => parseGuideFile(page({ inLanguage: 'nb' }), at), /inLanguage "nb" disagrees with its folder "en"/);
  assert.throws(() => parseGuideFile(page({ mainEntity: [] }), at), /has no questions/);
  const noAnswer = page();
  noAnswer.mainEntity[0].acceptedAnswer = { '@type': 'Answer' };
  assert.throws(() => parseGuideFile(noAnswer, at), /mainEntity\[0\]: "acceptedAnswer" needs a "text"/);
});

test('buttons are laisiangtho: targets, checked', () => {
  assert.deepEqual(actionOf('laisiangtho:command/search.open', 'x'), { cmd: 'search.open' });
  assert.deepEqual(actionOf('laisiangtho:doc/library', 'x'), { doc: 'library' });
  assert.deepEqual(actionOf('laisiangtho:palette/compare', 'x'), { palette: 'compare ' });
  assert.deepEqual(actionOf('laisiangtho:passage/43/3/16', 'x'), { passage: { book: 43, chapter: 3, verse: 16 } });
  assert.deepEqual(actionOf('laisiangtho:passage/19/23', 'x'), { passage: { book: 19, chapter: 23, verse: null } });
  assert.equal(actionOf(undefined, 'x'), null);
  assert.throws(() => actionOf('https://example.org', 'here'), /here: potentialAction target must be/);
  assert.throws(() => actionOf('laisiangtho:passage/john/3', 'here'), /passage target must be/);
});

test('which paths are data, and which are neither data nor Markdown', () => {
  const paths = ['guide/README.md', 'guide/en/help/a.json', 'guide/nb/books/1.jsonld', 'guide/en/notes.txt', 'guide/a.json', 'json/kjv.json'];
  assert.deepEqual(guidePaths(paths), ['guide/en/help/a.json', 'guide/nb/books/1.jsonld']);
  assert.deepEqual(strayPaths(paths), ['guide/en/notes.txt', 'guide/a.json']);
});

test('an update fetches only what changed, keeps the rest, and lets go of what went', async (t) => {
  const tree = (items) => ({ truncated: false, tree: items.map(([path, sha]) => ({ path, sha, type: 'blob', size: 10 })) });
  let listing = tree([['guide/en/a.json', '1'], ['guide/en/b.json', '1'], ['guide/nb/a.json', '1'], ['guide/README.md', '1']]);
  const fetched = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const body = url.includes('trees') ? listing
      : url.endsWith('/guide/en/b.json') && listing.tree.find((i) => i.path === 'guide/en/b.json')?.sha === '2' ? { broken: true }
        : page({ name: url.split('/').pop() });
    if (!url.includes('trees')) fetched.push(url.split('/master/')[1]);
    return { ok: true, status: 200, json: async () => body };
  };
  const rows = new Map();
  const store = {
    guideFiles: async () => [...rows.values()],
    changeGuideFiles: async ({ put, remove }) => { for (const r of put) rows.set(r.path, r); for (const p of remove) rows.delete(p); },
    clearGuideFiles: async () => rows.clear(),
  };
  const config = { repoTreeUrl: 'https://api.example/trees', repoFileUrl: 'https://raw.example/master/{path}' };
  const data = createGuideData({ store, config });

  let result = await data.update(['en']);
  assert.deepEqual(fetched, ['guide/en/a.json', 'guide/en/b.json'], 'English only, and no Markdown');
  assert.deepEqual({ added: result.added, updated: result.updated, removed: result.removed, kept: result.kept }, { added: 2, updated: 0, removed: 0, kept: 0 });

  fetched.length = 0;
  listing = tree([['guide/en/a.json', '1'], ['guide/en/b.json', '2']]);
  result = await data.update(['en']);
  assert.deepEqual(fetched, ['guide/en/b.json'], 'only the file whose hash changed');
  assert.equal(result.failed.length, 1, 'which no longer reads');
  assert.match(result.failed[0].message, /guide\/en\/b.json: expected "@type": "FAQPage"/);
  assert.equal(rows.get('guide/en/b.json').sha, '1', 'and the copy that read is kept');

  listing = tree([['guide/en/a.json', '1']]);
  result = await data.update(['en']);
  assert.equal(result.removed, 1, 'a file gone from the repository is let go');
  assert.deepEqual([...rows.keys()], ['guide/en/a.json']);

  listing = { truncated: true, tree: [] };
  await assert.rejects(data.update(['en']), /cut short by GitHub/);
});
