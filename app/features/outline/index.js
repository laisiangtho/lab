/**
 * Outline: the headings of the chapter in view — its section headings and
 * verse titles — as a way to jump inside a long chapter.
 */

import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { L } from '../../shell/i18n.js';

export default {
  id: 'outline',
  setup(ctx) {
    const { annotations, registry, shell, state, store } = ctx;

    registry.pane({
      id: 'outline',
      side: 'right',
      order: 5,
      icon: 'info',
      title: L('pane.outline'),
      mount(el) {
        const body = h('div', { class: 'stack' });
        el.append(body);
        let token = 0;

        async function paint() {
          const run = ++token;
          const { translation, book, chapter } = state.get();
          if (!translation) { body.replaceChildren(h('p', { class: 'empty-hint' }, L('msg.noTranslations'))); return; }

          const meta = await store.getMeta(translation);
          const verses = await store.getChapter(translation, book, chapter);
          if (run !== token) return;
          if (!verses) { body.replaceChildren(h('p', { class: 'empty-hint' }, L('ch.noText', { tr: meta.info.shortname }))); return; }

          const rows = [];
          for (const key of Object.keys(verses).map(Number).sort((a, b) => a - b)) {
            const story = meta.story?.[book]?.[chapter]?.[key];
            if (story) rows.push({ verse: key, text: story.text, level: 1 });
            if (verses[key].title) rows.push({ verse: key, text: verses[key].title, level: 2 });
          }

          const { notes, marks } = annotations.forChapter(book, chapter);
          const facts = h('div', { class: 'card' },
            h('h4', {}, `${shell.workspace.bookName(book)} ${chapter}`),
            h('p', {}, [
              L('lbl.verses', { n: Object.keys(verses).length }),
              notes.length ? L('lbl.notes', { n: notes.length }) : null,
              marks.length ? L('lbl.marks', { n: marks.length }) : null,
            ].filter(Boolean).join(' · ')));

          body.replaceChildren(facts, ...(rows.length
            ? rows.map((row) => h('button', {
              class: `outline-row level-${row.level}`,
              onclick: (e) => shell.openVerse(book, chapter, row.verse, { newTab: wantsNewTab(e) }),
            }, h('span', { class: 'kbd' }, String(row.verse)), ' ', row.text))
            : [h('p', { class: 'empty-hint' }, L('empty.outline'))]));
        }

        const run = () => paint().catch((err) => shell.notify(err.message, 'error'));
        const offState = state.subscribe(run);
        const offNotes = annotations.on('change', run);
        run();
        return () => { offState(); offNotes(); };
      },
    });
  },
};
