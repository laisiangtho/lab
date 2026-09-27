/**
 * Tags: `#theme/shepherd` written in a note becomes a way back to every note
 * that carries it. The cloud sizes each tag by how often it is used.
 */

import { extractTags, noteTitle } from '../../core/markdown.js';
import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { L } from '../../shell/i18n.js';

export default {
  id: 'tags',
  setup(ctx) {
    const { annotations, registry, shell } = ctx;
    let selected = null;
    let repaint = null;

    /** @returns {Map<string, object[]>} tag → notes */
    function index() {
      const map = new Map();
      for (const note of annotations.allNotes()) {
        for (const tag of extractTags(note.text)) {
          if (!map.has(tag)) map.set(tag, []);
          map.get(tag).push(note);
        }
      }
      return map;
    }

    // Clicking a tag anywhere in the app lands here.
    shell.openTag = (tag) => {
      selected = tag;
      shell.selectPane('left', 'tags');
      repaint?.();
    };

    registry.command({ id: 'tags.open', title: L('pane.tags'), icon: 'tag', run: () => shell.selectPane('left', 'tags') });

    registry.pane({
      id: 'tags',
      side: 'left',
      order: 40,
      icon: 'tag',
      title: L('pane.tags'),
      mount(el) {
        const cloud = h('div', { class: 'tagcloud' });
        const results = h('div', { class: 'stack' });
        el.append(cloud, results);

        function paint() {
          const tags = [...index().entries()].sort(([a], [b]) => a.localeCompare(b));
          if (!tags.length) {
            cloud.replaceChildren(h('p', { class: 'empty-hint' }, L('empty.tags')));
            results.replaceChildren();
            return;
          }
          const most = Math.max(...tags.map(([, notes]) => notes.length));
          cloud.replaceChildren(...tags.map(([tag, notes]) => h('button', {
            class: `pill${tag === selected ? '' : ' plain'}`,
            style: { fontSize: `${0.82 + 0.5 * (notes.length / most)}em` },
            onclick: () => { selected = selected === tag ? null : tag; paint(); },
          }, `#${tag}`, h('span', { class: 'n' }, String(notes.length)))));

          const notes = selected ? (index().get(selected) ?? []) : [];
          results.replaceChildren(...notes.map((note) => h('button', {
            class: 'result-line',
            onclick: (e) => shell.openVerse(note.book, note.chapter, note.verse ?? 1, { newTab: wantsNewTab(e) }),
          },
            h('span', { class: 'kbd' }, `${shell.workspace.bookName(note.book)} ${note.chapter}${note.verse ? `:${note.verse}` : ''}`),
            ' ', noteTitle(note.text))));
        }

        repaint = paint;
        const off = annotations.on('change', paint);
        paint();
        return () => { off(); repaint = null; };
      },
    });
  },
};
