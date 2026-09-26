/**
 * Notes and bookmarks, held in memory and written through to IndexedDB.
 *
 * The set is small (hundreds of records), so it is loaded once at startup and
 * kept in maps: the reading surface asks "does this verse carry anything?" for
 * every verse it draws, and that has to be free.
 */

import { comparePassage, coversVerse, newNoteId, parseBookmark, parseNote, passageId, verseRange } from '../core/annotations.js';

export async function createAnnotations({ store, category }) {
  const notes = new Map();
  const marks = new Map();
  const events = new EventTarget();

  const loaded = await store.annotations();
  for (const raw of loaded.notes) {
    const note = parseNote(raw, { source: 'stored note', category });
    notes.set(note.id, note);
  }
  for (const raw of loaded.marks) {
    const mark = parseBookmark(raw, { source: 'stored bookmark', category });
    marks.set(mark.id, mark);
  }

  const emit = () => events.dispatchEvent(new CustomEvent('change'));

  return {
    /** Everything for one chapter, in canonical order. */
    forChapter(book, chapter) {
      const here = (list) => list.filter((a) => a.book === book && a.chapter === chapter).sort(comparePassage);
      return { notes: here([...notes.values()]), marks: here([...marks.values()]) };
    },
    /**
     * Quick lookups while a chapter is drawn. A run of verses is expanded, so
     * every verse it covers is tinted; a note's dot stays on the verse the note
     * starts at, where the reader put it.
     */
    chapterIndex(book, chapter) {
      const index = { notes: new Map(), marks: new Map() };
      for (const note of notes.values()) {
        if (note.book !== book || note.chapter !== chapter) continue;
        const key = note.verse ?? 0;
        index.notes.set(key, (index.notes.get(key) ?? 0) + 1);
      }
      for (const mark of marks.values()) {
        if (mark.book !== book || mark.chapter !== chapter) continue;
        for (const verse of verseRange(mark)) index.marks.set(verse, mark);
      }
      return index;
    },
    allNotes: () => [...notes.values()].sort(comparePassage),
    allMarks: () => [...marks.values()].sort(comparePassage),
    getNote: (id) => notes.get(id),
    /** Is this verse inside any bookmark — its own, or a run that covers it? */
    isMarked(book, chapter, verse) {
      if (marks.has(passageId(book, chapter, verse))) return true;
      for (const mark of marks.values()) {
        if (mark.book === book && mark.chapter === chapter && coversVerse(mark, verse)) return true;
      }
      return false;
    },
    /** The bookmark covering a verse, if there is one. */
    markAt(book, chapter, verse) {
      for (const mark of marks.values()) {
        if (mark.book === book && mark.chapter === chapter && coversVerse(mark, verse)) return mark;
      }
      return null;
    },

    async saveNote({ id, book, chapter, verse = null, to = null, text }) {
      const existing = id ? notes.get(id) : null;
      const note = parseNote({
        id: id ?? newNoteId(),
        book, chapter, verse, to, text,
        created: existing?.created,
        updated: new Date().toISOString(),
      }, { source: 'note', category });
      notes.set(note.id, note);
      await store.putAnnotation('notes', note);
      emit();
      return note;
    },

    async deleteNote(id) {
      if (!notes.delete(id)) return;
      await store.deleteAnnotation('notes', id);
      emit();
    },

    /**
     * Bookmark a verse or a run of them, or take the bookmark away.
     *
     * A run that is pressed while any of its verses is already bookmarked
     * clears those bookmarks rather than adding another on top: pressing the
     * same control twice puts the reader back where they started, which a
     * second overlapping record would not.
     *
     * @returns {boolean} whether the passage is bookmarked afterwards
     */
    async toggleMark(book, chapter, verse, colour = null, to = null) {
      const covering = [...marks.values()].filter((m) => m.book === book && m.chapter === chapter
        && verseRange({ verse, to }).some((v) => coversVerse(m, v)));
      if (covering.length) {
        for (const mark of covering) {
          marks.delete(mark.id);
          await store.deleteAnnotation('marks', mark.id);
        }
        emit();
        return false;
      }
      const mark = parseBookmark({ book, chapter, verse, to, colour }, { source: 'bookmark', category });
      marks.set(mark.id, mark);
      await store.putAnnotation('marks', mark);
      emit();
      return true;
    },

    /**
     * Replace every note of one chapter — what source mode saves. Notes that
     * vanished from the text are deleted, the rest are written as given.
     */
    async replaceChapterNotes(book, chapter, incoming) {
      const existing = [...notes.values()].filter((n) => n.book === book && n.chapter === chapter);
      for (const note of existing) {
        notes.delete(note.id);
        await store.deleteAnnotation('notes', note.id);
      }
      for (const { verse, text } of incoming) {
        if (!text.trim()) continue;
        const keep = existing.find((n) => n.verse === (verse ?? null));
        const note = parseNote({
          id: keep?.id ?? newNoteId(), book, chapter, verse: verse ?? null, text,
          created: keep?.created, updated: new Date().toISOString(),
        }, { source: 'source mode', category });
        notes.set(note.id, note);
        await store.putAnnotation('notes', note);
      }
      emit();
    },

    /** For the settings export. */
    toJSON: () => ({ notes: [...notes.values()], marks: [...marks.values()] }),

    /** Import: records replace those with the same id, nothing is dropped. */
    async merge({ notes: incomingNotes = [], marks: incomingMarks = [] }) {
      const checkedNotes = incomingNotes.map((raw) => parseNote(raw, { source: 'imported note', category }));
      const checkedMarks = incomingMarks.map((raw) => parseBookmark(raw, { source: 'imported bookmark', category }));
      for (const note of checkedNotes) notes.set(note.id, note);
      for (const mark of checkedMarks) marks.set(mark.id, mark);
      await store.mergeAnnotations({ notes: checkedNotes, marks: checkedMarks });
      emit();
      return { notes: checkedNotes.length, marks: checkedMarks.length };
    },

    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}
