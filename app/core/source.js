/**
 * Source mode: the chapter as plain Markdown, and the way back.
 *
 * Scripture is read-only — it belongs to the translation file, which the app
 * never edits. What a reader may change in source mode is their own material:
 * the notes under "## Notes". Everything above that heading is compared on
 * save and a change there is refused, loudly, rather than silently dropped.
 */

import { verseLabel } from './align.js';
import { plainText } from './strongs.js';

export const NOTES_HEADING = '## Notes';

/**
 * @param {{ meta: object, verses: object|null, book: number, chapter: number,
 *           bookName: string, notes: {verse: number|null, text: string}[] }} p
 */
export function toMarkdown({ meta, verses, book, chapter, bookName, notes = [] }) {
  const lines = [`# ${bookName} ${chapter}`, '', `> ${meta.info.name} (${meta.info.shortname}) · ${meta.info.language.text}`, ''];

  if (!verses) lines.push('_This translation does not contain this chapter._', '');
  else {
    for (const key of Object.keys(verses).map(Number).sort((a, b) => a - b)) {
      const verse = verses[key];
      const story = meta.story?.[book]?.[chapter]?.[key];
      if (story) lines.push(`## ${story.text}`, '');
      if (verse.title) lines.push(`### ${verse.title}`, '');
      // Markdown has no place for a Strong's number; the USFM, USX and OSIS
      // views carry them.
      lines.push(`**${verseLabel(key, verse)}** ${plainText(verse.text)}`);
      if (verse.ref) lines.push(`> ${verse.ref}`);
      lines.push('');
    }
  }

  lines.push(NOTES_HEADING, '');
  const chapterNote = notes.find((n) => n.verse === null);
  if (chapterNote) lines.push(chapterNote.text, '');
  for (const note of notes.filter((n) => n.verse !== null).sort((a, b) => a.verse - b.verse)) {
    lines.push(`- **${note.verse}** ${note.text.replace(/\n+/g, ' ')}`, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Read an edited source back.
 * @returns {{ notes: { verse: number|null, text: string }[] }}
 * @throws {Error} when anything above the notes heading was changed
 */
export function fromMarkdown(edited, original) {
  const split = (text) => {
    const at = text.indexOf(`\n${NOTES_HEADING}`);
    return at === -1
      ? { scripture: text.trimEnd(), notes: '' }
      : { scripture: text.slice(0, at).trimEnd(), notes: text.slice(at + NOTES_HEADING.length + 1).trim() };
  };

  const before = split(original);
  const after = split(edited);
  if (before.scripture !== after.scripture) {
    throw new Error('Source mode edits notes only — the scripture above "## Notes" belongs to the translation file and was changed.');
  }

  const notes = [];
  let chapterLines = [];
  for (const line of after.notes.split('\n')) {
    const verseNote = /^[-*]\s+\*\*(\d+)\*\*\s+(.+)$/.exec(line.trim());
    if (verseNote) {
      notes.push({ verse: Number(verseNote[1]), text: verseNote[2].trim() });
    } else {
      chapterLines.push(line);
    }
  }
  const chapterText = chapterLines.join('\n').trim();
  if (chapterText) notes.unshift({ verse: null, text: chapterText });
  return { notes };
}
