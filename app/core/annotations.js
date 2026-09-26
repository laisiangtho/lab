/**
 * Notes and bookmarks.
 *
 * Both key on the passage, never on a translation: a note written while reading
 * one translation belongs to that verse, so it is there in every other one too.
 *
 *   note      { id, book, chapter, verse|null, to|null, text, created, updated }
 *   bookmark  { id, book, chapter, verse, to|null, colour|null, created }
 *
 * `id` is derived from the passage for bookmarks (one per starting verse) and
 * random for notes (a verse may carry several).
 *
 * A passage may be a run of verses: `verse` is where it starts and `to` where
 * it ends. That is what a sermon or a study note is usually about — "the first
 * five verses", not the third one — and a record that could only hold a single
 * verse forced a reader to write the same note five times. `to` is null for a
 * single verse, and for a chapter note, where `verse` is null as well.
 */

import { expectObject, expectString, fail } from './errors.js';

export const COLOURS = Object.freeze(['yellow', 'green', 'blue', 'purple', 'red']);

export function passageId(book, chapter, verse) {
  return verse === null || verse === undefined ? `${book}.${chapter}` : `${book}.${chapter}.${verse}`;
}

/** The verses a note or bookmark covers, first to last. */
export function verseRange({ verse, to }) {
  if (verse === null || verse === undefined) return [];
  const last = to ?? verse;
  const out = [];
  for (let v = verse; v <= last; v += 1) out.push(v);
  return out;
}

export function coversVerse(annotation, verse) {
  if (annotation.verse === null || annotation.verse === undefined) return false;
  return verse >= annotation.verse && verse <= (annotation.to ?? annotation.verse);
}

/**
 * "3" or "3–7" — the verse part of a reference, in the digits given. The dash
 * is an en dash, as it is between the numbers of a range everywhere else.
 */
export function verseLabelOf({ verse, to }, digits = (n) => String(n)) {
  if (verse === null || verse === undefined) return '';
  return to && to !== verse ? `${digits(verse)}–${digits(to)}` : digits(verse);
}

export function newNoteId() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Sort key: canonical order, chapter notes before verse notes. */
export function comparePassage(a, b) {
  return a.book - b.book || a.chapter - b.chapter || (a.verse ?? 0) - (b.verse ?? 0);
}

export function parseNote(raw, { source, category }) {
  expectObject(raw, source, '$');
  const { book, chapter, verse, to } = parsePassage(raw, { source, category, verseOptional: true });
  const text = expectString(raw.text, source, '$.text');
  const created = timestamp(raw.created, source, '$.created');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newNoteId(),
    book, chapter, verse, to, text,
    created,
    updated: timestamp(raw.updated, source, '$.updated', created),
  };
}

export function parseBookmark(raw, { source, category }) {
  expectObject(raw, source, '$');
  const { book, chapter, verse, to } = parsePassage(raw, { source, category, verseOptional: false });
  const colour = raw.colour === undefined || raw.colour === null ? null : expectString(raw.colour, source, '$.colour');
  if (colour !== null && !COLOURS.includes(colour)) fail(source, '$.colour', `expected one of ${COLOURS.join(', ')}`);
  return { id: passageId(book, chapter, verse), book, chapter, verse, to, colour, created: timestamp(raw.created, source, '$.created') };
}

function parsePassage(raw, { source, category, verseOptional }) {
  const book = raw.book;
  if (!Number.isInteger(book) || !category.hasBook(book)) fail(source, '$.book', `unknown book ${JSON.stringify(book)}`);
  const chapters = category.book(book).chapters;
  const chapter = raw.chapter;
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > chapters) {
    fail(source, '$.chapter', `chapter ${JSON.stringify(chapter)} is outside ${category.book(book).shortname} (1–${chapters})`);
  }
  const verse = raw.verse === undefined || raw.verse === null ? null : raw.verse;
  if (verse !== null && (!Number.isInteger(verse) || verse < 1)) fail(source, '$.verse', `expected a verse number, got ${JSON.stringify(verse)}`);
  if (verse === null && !verseOptional) fail(source, '$.verse', 'a bookmark needs a verse');
  // The last verse of a run. How many verses a chapter has is the
  // translation's business, not the canon's, so only the order is checked
  // here: a run that ends before it starts is a mistake, one that runs past
  // the end of a particular edition is not.
  const last = raw.to === undefined || raw.to === null ? null : raw.to;
  if (last !== null) {
    if (verse === null) fail(source, '$.to', 'a run of verses needs a first verse');
    if (!Number.isInteger(last) || last < verse) {
      fail(source, '$.to', `expected a verse at or after ${verse}, got ${JSON.stringify(last)}`);
    }
  }
  const to = last === verse ? null : last;
  return { book, chapter, verse, to };
}

function timestamp(value, source, path, fallback) {
  if (value === undefined || value === null) return fallback ?? new Date().toISOString();
  const text = expectString(value, source, path);
  if (Number.isNaN(Date.parse(text))) fail(source, path, `not an ISO date: ${text}`);
  return text;
}
