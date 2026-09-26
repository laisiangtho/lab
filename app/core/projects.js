/**
 * Study projects: a piece of work with passages in it.
 *
 * A note answers "what do I think about this verse". A project answers the
 * question that actually brings people here — "what am I preparing, and what
 * goes in it": a sermon, a lesson, a chapter of a thesis, a reading plan of
 * one's own. So a project is an ordered list of entries, and an entry is
 * either a passage, a piece of writing, or something still to do. All three in
 * one list, because that is how the work is: a passage, a thought about it, and
 * a reminder to check the Greek.
 *
 *   project  { id, name, summary, entries[], created, updated }
 *   entry    { id, kind: 'passage'|'text'|'todo', text, done,
 *              book, chapter, verse, to }
 *
 * Passages are stored as references, never as copied text: the text belongs to
 * whichever translation is being read, and a project that carried a copy would
 * be wrong the moment its owner changed translation.
 *
 * Pure. The store, the rendering and the files are elsewhere.
 */

import { expectArray, expectObject, expectString, fail, isPlainObject } from './errors.js';

export const ENTRY_KINDS = Object.freeze(['passage', 'text', 'todo']);
export const PROJECT_SCHEMA = 1;

const id = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();

export function createProject(name = 'Untitled') {
  const stamp = now();
  return { id: id(), name: String(name).trim() || 'Untitled', summary: '', entries: [], created: stamp, updated: stamp };
}

/**
 * @param {{ kind?: string, text?: string, book?: number, chapter?: number,
 *           verse?: number|null, to?: number|null }} entry
 */
export function createEntry({ kind = 'text', text = '', book = null, chapter = null, verse = null, to = null } = {}) {
  if (!ENTRY_KINDS.includes(kind)) throw new Error(`projects: unknown entry kind "${kind}"`);
  return {
    id: id(),
    kind,
    text: String(text ?? ''),
    done: false,
    book: kind === 'passage' ? book : null,
    chapter: kind === 'passage' ? chapter : null,
    verse: kind === 'passage' ? (verse ?? null) : null,
    to: kind === 'passage' && to && to !== verse ? to : null,
    created: now(),
  };
}

/** A copy of the project with one entry changed, and its stamp moved on. */
export function editEntry(project, entryId, patch) {
  return touch({
    ...project,
    entries: project.entries.map((entry) => (entry.id === entryId ? { ...entry, ...patch, id: entry.id } : entry)),
  });
}

export function addEntry(project, entry) {
  return touch({ ...project, entries: [...project.entries, entry] });
}

export function removeEntry(project, entryId) {
  return touch({ ...project, entries: project.entries.filter((entry) => entry.id !== entryId) });
}

/**
 * Move an entry by `delta` places. Out-of-range moves are no-ops rather than
 * errors: the button at the top of the list is pressed by accident often.
 */
export function moveEntry(project, entryId, delta) {
  const at = project.entries.findIndex((entry) => entry.id === entryId);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= project.entries.length) return project;
  const entries = [...project.entries];
  const [moved] = entries.splice(at, 1);
  entries.splice(to, 0, moved);
  return touch({ ...project, entries });
}

function touch(project) {
  return { ...project, updated: now() };
}

/** How much of the work is done, for the reader who wants to know. */
export function progressOf(project) {
  const todos = project.entries.filter((entry) => entry.kind === 'todo');
  return {
    passages: project.entries.filter((entry) => entry.kind === 'passage').length,
    notes: project.entries.filter((entry) => entry.kind === 'text').length,
    todo: todos.length,
    done: todos.filter((entry) => entry.done).length,
    words: project.entries.reduce((n, entry) => n + countWords(entry.text), 0) + countWords(project.summary),
  };
}

function countWords(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The project as a document: a heading, the summary, then each entry in order.
 *
 * `reference` names a passage entry — it is passed in because naming a book is
 * the translation's business, not this module's.
 *
 * @param {object} project
 * @param {{ reference: (entry: object) => string, includeDone?: boolean }} options
 */
export function toMarkdown(project, { reference, includeDone = true }) {
  const out = [`# ${project.name}`, ''];
  if (project.summary.trim()) out.push(project.summary.trim(), '');
  for (const entry of project.entries) {
    if (entry.kind === 'todo') {
      if (!includeDone && entry.done) continue;
      out.push(`- [${entry.done ? 'x' : ' '}] ${entry.text.trim()}`);
      continue;
    }
    if (entry.kind === 'passage') {
      out.push('', `## ${reference(entry)}`, '');
      if (entry.text.trim()) out.push(entry.text.trim(), '');
      continue;
    }
    out.push('', entry.text.trim(), '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The file written by an export: a project, with enough around it to check. */
export function buildProjectFile(project, { appVersion = null } = {}) {
  return {
    app: 'lai-siangtho',
    kind: 'project',
    schema: PROJECT_SCHEMA,
    exportedAt: now(),
    appVersion,
    project,
  };
}

/**
 * Read a project file back. Strict, like every other import: this is someone
 * else's file, and a project that half-loads is worse than one that refuses.
 *
 * @param {unknown} raw
 * @param {{ source: string }} options
 */
export function parseProjectFile(raw, { source }) {
  expectObject(raw, source, '$');
  if (raw.app !== 'lai-siangtho') fail(source, '$.app', `expected "lai-siangtho", got ${JSON.stringify(raw.app)}`);
  if (raw.kind !== 'project') fail(source, '$.kind', `expected "project", got ${JSON.stringify(raw.kind)}`);
  if (raw.schema !== PROJECT_SCHEMA) fail(source, '$.schema', `this build reads schema ${PROJECT_SCHEMA}, the file says ${JSON.stringify(raw.schema)}`);
  return parseProject(raw.project, { source, path: '$.project' });
}

export function parseProject(raw, { source, path = '$' }) {
  expectObject(raw, source, path);
  const name = expectString(raw.name, source, `${path}.name`).trim();
  if (!name) fail(source, `${path}.name`, 'a project needs a name');
  const entries = (raw.entries === undefined ? [] : expectArray(raw.entries, source, `${path}.entries`))
    .map((entry, i) => parseEntry(entry, { source, path: `${path}.entries[${i}]` }));
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : id(),
    name,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    entries,
    created: typeof raw.created === 'string' ? raw.created : now(),
    updated: typeof raw.updated === 'string' ? raw.updated : now(),
  };
}

function parseEntry(raw, { source, path }) {
  expectObject(raw, source, path);
  const kind = expectString(raw.kind, source, `${path}.kind`);
  if (!ENTRY_KINDS.includes(kind)) fail(source, `${path}.kind`, `expected one of ${ENTRY_KINDS.join(', ')}`);
  const whole = (value, key) => {
    if (!Number.isInteger(value) || value < 1) fail(source, `${path}.${key}`, `expected a positive whole number, got ${JSON.stringify(value)}`);
    return value;
  };
  const entry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : id(),
    kind,
    text: typeof raw.text === 'string' ? raw.text : '',
    done: raw.done === true,
    book: null,
    chapter: null,
    verse: null,
    to: null,
    created: typeof raw.created === 'string' ? raw.created : now(),
  };
  if (kind !== 'passage') return entry;
  entry.book = whole(raw.book, 'book');
  entry.chapter = whole(raw.chapter, 'chapter');
  entry.verse = raw.verse === null || raw.verse === undefined ? null : whole(raw.verse, 'verse');
  entry.to = raw.to === null || raw.to === undefined ? null : whole(raw.to, 'to');
  if (entry.to !== null && entry.verse === null) fail(source, `${path}.to`, 'a range needs a first verse');
  if (entry.to !== null && entry.to < entry.verse) fail(source, `${path}.to`, `ends (${entry.to}) before it starts (${entry.verse})`);
  if (entry.to === entry.verse) entry.to = null;
  return entry;
}

/** The whole shelf, as it is kept in the records store. */
export function parseShelf(raw) {
  if (!isPlainObject(raw)) return { projects: [], open: null };
  const projects = Array.isArray(raw.projects)
    ? raw.projects.map((project) => {
      try {
        return parseProject(project, { source: 'stored projects' });
      } catch {
        // A project this build cannot read is dropped rather than allowed to
        // stop the app; it is still in the export file, which is the copy that
        // matters.
        return null;
      }
    }).filter(Boolean)
    : [];
  const open = projects.some((project) => project.id === raw.open) ? raw.open : (projects[0]?.id ?? null);
  return { projects, open };
}
