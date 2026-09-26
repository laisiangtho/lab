/**
 * Take a passage out of the app: as Markdown, as a citation, as a file, or as
 * a printed sheet — with the reader's own notes and bookmarks in it.
 *
 * Reading is only half of what this app is for. The other half is the essay,
 * the sermon, the handout and the lesson that the reading is for, and all of
 * those happen somewhere else. What that work needs is not a screenshot of a
 * chapter: it is the verses, correctly referenced, in the shape of whatever is
 * being written — and, since the reader's notes are here and nowhere else,
 * those too.
 *
 * Every format is built by `core/passage.js`, which is pure and tested. This
 * feature's job is to gather what that needs: the text from the store, the
 * notes from annotations, the names from the translation being read.
 */

import { verseLabel } from '../../core/align.js';
import { coversVerse, verseLabelOf } from '../../core/annotations.js';
import { toCitation, toMarkdown, toPrintable } from '../../core/passage.js';
import { L } from '../../shell/i18n.js';

export default {
  id: 'export-passage',
  setup(ctx) {
    const { annotations, category, platform, registry, shell, state, store } = ctx;

    /**
     * Everything the formats need about one passage.
     * @param {{ book: number, chapter: number, verse?: number|null, to?: number|null }} p
     */
    async function gather(p) {
      const { translation } = state.get();
      if (!translation) throw new Error(L('msg.noTranslations'));
      const [meta, verses] = await Promise.all([
        store.getMeta(translation),
        store.getChapter(translation, p.book, p.chapter),
      ]);
      if (!verses) throw new Error(L('ch.noText', { tr: meta.info.shortname }));

      const from = p.verse ?? 1;
      const to = p.to ?? (p.verse ?? Number.MAX_SAFE_INTEGER);
      const keys = Object.keys(verses).map(Number)
        .filter((n) => n >= from && n <= to)
        .sort((a, b) => a - b);

      const marks = annotations.forChapter(p.book, p.chapter).marks;
      const lines = keys.map((key) => ({
        verse: key,
        label: verseLabel(key, verses[key]),
        text: verses[key].text,
        title: verses[key].title ?? null,
        marked: marks.some((mark) => coversVerse(mark, key)),
      }));

      // A note belongs to the passage when it sits inside it — and a chapter
      // note (no verse) belongs to any passage from that chapter.
      const name = meta.books?.[p.book]?.name ?? category.book(p.book).name;
      const notes = annotations.forChapter(p.book, p.chapter).notes
        .filter((note) => note.verse === null || (note.verse >= from && note.verse <= to))
        .map((note) => ({
          label: `${name} ${p.chapter}${note.verse === null ? '' : `:${verseLabelOf(note)}`}`,
          text: note.text ?? '',
        }));

      const span = keys.length && p.verse
        ? `:${keys.length > 1 ? `${keys[0]}–${keys.at(-1)}` : keys[0]}`
        : '';
      return {
        reference: `${name} ${p.chapter}${span}`,
        translation: meta.info.name ?? meta.info.shortname ?? translation,
        identify: translation,
        lines,
        notes,
      };
    }

    async function copy(text, what) {
      await navigator.clipboard.writeText(text);
      shell.notify(L('msg.copied', { what }));
    }

    /** The file, through the platform's dialog where there is one. */
    async function save(name, content, type) {
      if (platform.capabilities.saveFile) {
        const result = await platform.capabilities.saveFile({ defaultName: name, content });
        shell.notify(result.saved ? L('msg.saved', { name: result.path }) : L('msg.exportCancelled'));
        return;
      }
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      shell.notify(L('msg.saved', { name }));
    }

    /**
     * The sheet is printed from a window of its own: the app's own stylesheet
     * has nothing to do with paper, and a reader who wants a PDF gets one from
     * the print dialog without this app pretending to make one.
     */
    function print(html) {
      const view = window.open('', '_blank', 'width=780,height=920');
      if (!view) { shell.notify(L('msg.printBlocked'), 'error'); return; }
      view.document.write(html);
      view.document.close();
      view.focus();
      // Give the document a frame to lay itself out before the dialog opens.
      setTimeout(() => { view.print(); }, 250);
    }

    const slug = (passage) => `${passage.identify}-${passage.reference}`
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    /** The shapes a passage can leave in, offered as a list. */
    async function offer(p) {
      const passage = await gather(p);
      shell.pick({
        placeholder: L('ph.exportAs', { ref: passage.reference }),
        items: [
          {
            id: 'md', title: L('exp.markdown'), sub: L('exp.markdownHint'), icon: 'copy',
            run: () => copy(toMarkdown(passage), passage.reference),
          },
          {
            id: 'cite', title: L('exp.citation'), sub: L('exp.citationHint'), icon: 'quote',
            run: () => copy(toCitation(passage), passage.reference),
          },
          {
            id: 'plain', title: L('exp.plain'), sub: L('exp.plainHint'), icon: 'copy',
            run: () => copy(passage.lines.map((line) => `${line.label} ${line.text}`).join('\n'), passage.reference),
          },
          {
            id: 'file', title: L('exp.file'), sub: L('exp.fileHint'), icon: 'download',
            run: () => save(`${slug(passage)}.md`, toMarkdown(passage), 'text/markdown'),
          },
          {
            id: 'sheet', title: L('exp.sheet'), sub: L('exp.sheetHint'), icon: 'files',
            run: () => print(toPrintable(passage)),
          },
        ],
        onPick: (item) => item.run(),
      });
    }

    const guard = (p) => offer(p).catch((err) => shell.notify(err.message, 'error'));

    registry.command({
      id: 'passage.export',
      title: L('cmd.exportPassage'),
      icon: 'download',
      needsChapter: true,
      run: () => {
        const { book, chapter } = state.get();
        return guard({ book, chapter, verse: null, to: null });
      },
    });

    registry.verseAction({
      id: 'passage.export',
      title: L('cmd.exportPassage'),
      icon: 'download',
      run: (p) => guard(p),
    });

    registry.verb({
      id: 'passage.export',
      word: 'export',
      title: L('verb.export'),
      icon: 'download',
      hint: L('verb.exportHint'),
      run: (p) => guard(p),
    });
  },
};
