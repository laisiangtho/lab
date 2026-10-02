/**
 * Bookmarks: one per verse, kept against the passage. A bookmarked verse is
 * tinted in every translation, since the mark belongs to the verse.
 */

import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { verseLabelOf, verseRange } from '../../core/annotations.js';

export default {
  id: 'bookmarks',
  setup(ctx) {
    const { annotations, registry, shell, store, state } = ctx;

    registry.verseAction({
      id: 'bookmarks.toggle',
      title: (p) => (annotations.isMarked(p.book, p.chapter, p.verse) ? L('cmd.unbookmark') : L('cmd.bookmark')),
      icon: 'bookmark',
      isOn: (p) => annotations.isMarked(p.book, p.chapter, p.verse),
      run: async (p) => {
        const marked = await annotations.toggleMark(p.book, p.chapter, p.verse, null, p.to ?? null);
        shell.notify(marked ? L('msg.bookmarked') : L('msg.unbookmarked'));
      },
    });

    registry.verseAction({
      id: 'bookmarks.copy',
      title: L('cmd.copyVerse'),
      icon: 'copy',
      // A run of verses is copied as the passage it is, numbered, with one
      // reference under it — which is what goes into a sermon or a slide.
      run: async (p) => {
        const { translation } = state.get();
        const verses = translation ? await store.getChapter(translation, p.book, p.chapter) : null;
        const span = p.to && p.to !== p.verse ? `${p.verse}–${p.to}` : String(p.verse);
        const ref = `${shell.workspace.bookName(p.book)} ${p.chapter}:${span}`;
        const lines = [];
        for (let v = p.verse; v <= (p.to ?? p.verse); v += 1) {
          const text = verses?.[v]?.text;
          if (text) lines.push(p.to ? `${v}. ${text}` : text);
        }
        await navigator.clipboard.writeText(lines.length ? `${lines.join('\n')}\n— ${ref}` : ref);
        shell.notify(L('msg.copied', { what: ref }));
      },
    });

    registry.verseAction({
      id: 'bookmarks.link',
      title: L('cmd.copyLink'),
      icon: 'link',
      // An address that opens on this verse, for a message or a page: it opens
      // the web build for somebody without the app.
      run: async (p) => {
        const link = shell.passageLink(p);
        await navigator.clipboard.writeText(link);
        shell.notify(L('msg.linkCopied'));
      },
    });

    registry.verb({
      id: 'bookmarks.verb',
      word: 'mark',
      title: L('verb.mark'),
      icon: 'bookmark',
      hint: L('verb.markHint'),
      // A whole chapter has no verse to mark, so the first verse stands for it:
      // a bookmark is a place to come back to, and that is where a reader comes back to.
      run: async (p) => {
        const verse = p.verse ?? 1;
        const marked = await annotations.toggleMark(p.book, p.chapter, verse, null, p.to ?? null);
        shell.notify(marked ? L('msg.bookmarked') : L('msg.unbookmarked'));
        shell.openVerse(p.book, p.chapter, verse);
      },
    });

    registry.command({
      id: 'bookmarks.open',
      title: L('pane.marks'),
      icon: 'bookmark',
      run: () => shell.selectPane('left', 'marks'),
    });

    registry.pane({
      id: 'marks',
      side: 'left',
      order: 30,
      icon: 'bookmark',
      title: L('pane.marks'),
      mount(el) {
        const body = h('div', { class: 'stack' });
        el.append(body);

        async function paint() {
          const marks = annotations.allMarks();
          if (!marks.length) {
            body.replaceChildren(h('p', { class: 'empty-hint' }, L('empty.marks')));
            return;
          }
          const { translation } = state.get();
          const rows = await Promise.all(marks.map(async (mark) => {
            const verses = translation ? await store.getChapter(translation, mark.book, mark.chapter) : null;
            // A run of verses shows as the passage it is, so the row says what
            // was marked rather than only where it starts.
            const text = verseRange(mark).map((v) => verses?.[v]?.text).filter(Boolean).join(' ');
            return { mark, text: text || null };
          }));
          body.replaceChildren(...rows.map(({ mark, text }) => h('div', { class: 'mark-row' },
            h('button', {
              class: 'mark-open',
              onclick: (e) => shell.openVerse(mark.book, mark.chapter, mark.verse, { newTab: wantsNewTab(e) }),
            },
              h('span', { class: 'mark-ref' },
                `${shell.workspace.bookName(mark.book)} ${mark.chapter}:${verseLabelOf(mark, (n) => shell.workspace.number(n))}`),
              text ? h('span', { class: 'mark-text' }, text) : null),
            h('button', {
              class: 'mark-remove', title: L('cmd.unbookmark'), 'aria-label': L('cmd.unbookmark'),
              onclick: () => annotations.toggleMark(mark.book, mark.chapter, mark.verse, null, mark.to ?? null),
            }, icon('x')))));
        }

        const run = () => paint().catch((err) => shell.notify(err.message, 'error'));
        const offMarks = annotations.on('change', run);
        const offState = state.subscribe(run);
        run();
        return () => { offMarks(); offState(); };
      },
    });
  },
};
