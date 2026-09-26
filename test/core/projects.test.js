import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  addEntry, buildProjectFile, createEntry, createProject, editEntry, moveEntry,
  parseProjectFile, parseShelf, progressOf, removeEntry, toMarkdown,
} from '../../app/core/projects.js';

const sermon = () => {
  let project = createProject('Advent 1');
  project = addEntry(project, createEntry({ kind: 'passage', book: 19, chapter: 23, verse: 1, to: 3, text: 'The shepherd image.' }));
  project = addEntry(project, createEntry({ kind: 'text', text: 'Open with the question.' }));
  project = addEntry(project, createEntry({ kind: 'todo', text: 'Check the Hebrew' }));
  return project;
};

test('a new project is empty and named', () => {
  const project = createProject('  ');
  assert.equal(project.name, 'Untitled');
  assert.deepEqual(project.entries, []);
});

test('entries keep a passage as a reference, never as text', () => {
  const entry = createEntry({ kind: 'passage', book: 19, chapter: 23, verse: 1, to: 6 });
  assert.equal(entry.book, 19);
  assert.equal(entry.to, 6);
  // A "range" of one verse is a verse.
  assert.equal(createEntry({ kind: 'passage', book: 1, chapter: 1, verse: 3, to: 3 }).to, null);
  // A text entry cannot smuggle a passage in.
  assert.equal(createEntry({ kind: 'text', book: 19 }).book, null);
});

test('entries can be edited, moved and removed without losing their identity', () => {
  let project = sermon();
  const [first, , third] = project.entries;
  project = editEntry(project, first.id, { text: 'Changed', id: 'nope' });
  assert.equal(project.entries[0].text, 'Changed');
  assert.equal(project.entries[0].id, first.id);

  project = moveEntry(project, third.id, -2);
  assert.equal(project.entries[0].id, third.id);
  // Off the end is a no-op, not an error.
  assert.equal(moveEntry(project, third.id, -1).entries[0].id, third.id);

  project = removeEntry(project, third.id);
  assert.equal(project.entries.length, 2);
  assert.ok(!project.entries.some((entry) => entry.id === third.id));
});

test('progress counts what the work is made of', () => {
  const project = sermon();
  const progress = progressOf(project);
  assert.equal(progress.passages, 1);
  assert.equal(progress.notes, 1);
  assert.equal(progress.todo, 1);
  assert.equal(progress.done, 0);
  assert.ok(progress.words > 5);
});

test('markdown writes the project out in order, with the references named', () => {
  const out = toMarkdown(sermon(), { reference: (entry) => `Psalm ${entry.chapter}:${entry.verse}–${entry.to}` });
  assert.match(out, /^# Advent 1\n/);
  assert.match(out, /## Psalm 23:1–3/);
  assert.match(out, /The shepherd image\./);
  assert.match(out, /- \[ \] Check the Hebrew/);
  assert.ok(!out.includes('\n\n\n'));
});

test('a project survives a round trip through its file', () => {
  const project = sermon();
  const file = buildProjectFile(project, { appVersion: '26.09.26.2' });
  const back = parseProjectFile(JSON.parse(JSON.stringify(file)), { source: 'test' });
  assert.equal(back.name, project.name);
  assert.equal(back.entries.length, 3);
  assert.deepEqual(back.entries.map((e) => e.kind), ['passage', 'text', 'todo']);
  assert.equal(back.entries[0].to, 3);
});

test('a file that is not one of ours is refused, by name and by place', () => {
  assert.throws(() => parseProjectFile({ app: 'other', kind: 'project', schema: 1, project: {} }, { source: 'f.json' }), /\$\.app/);
  assert.throws(() => parseProjectFile({ app: 'lai-siangtho', kind: 'note', schema: 1, project: {} }, { source: 'f.json' }), /\$\.kind/);
  assert.throws(() => parseProjectFile({ app: 'lai-siangtho', kind: 'project', schema: 9, project: {} }, { source: 'f.json' }), /schema/);
  assert.throws(() => parseProjectFile({
    app: 'lai-siangtho', kind: 'project', schema: 1,
    project: { name: 'x', entries: [{ kind: 'passage', book: 1, chapter: 1, verse: 5, to: 2 }] },
  }, { source: 'f.json' }), /ends \(2\) before it starts \(5\)/);
});

test('the shelf drops what it cannot read rather than failing to open', () => {
  const good = sermon();
  const shelf = parseShelf({ projects: [good, { name: '' }, null], open: good.id });
  assert.equal(shelf.projects.length, 1);
  assert.equal(shelf.open, good.id);
  // Nothing stored at all is an empty shelf, not a crash.
  assert.deepEqual(parseShelf(null), { projects: [], open: null });
});
