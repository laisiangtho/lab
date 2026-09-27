/**
 * Backlinks: which notes point at the chapter in view.
 *
 * Linked mentions come from `[[Genesis 1]]` wikilinks, resolved through the
 * same reference parser the cross-references use. Unlinked mentions are notes
 * that name the passage in plain text — Phase 1 showed both, and the second is
 * often where the thought actually is.
 */

import { extractLinks, noteTitle } from '../../core/markdown.js';
import { parseReferences } from '../../core/reference.js';
import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

export default {
  id: 'backlinks',
  setup(ctx) {
    const { annotations, registry, shell, state } = ctx;

    registry.pane({
      id: 'links',
      side: 'right',
      order: 20,
      icon: 'link',
      title: L('pane.links'),
      mount(el) {
        const body = h('div', { class: 'stack' });
        el.append(body);

        function paint() {
          const { book, chapter } = state.get();
          const resolver = shell.workspace.resolver?.();
          const label = `${shell.workspace.bookName(book)} ${chapter}`;
          const linked = [];
          const unlinked = [];

          for (const note of annotations.allNotes()) {
            if (note.book === book && note.chapter === chapter) continue; // its own chapter is not a mention
            const targets = resolver
              ? extractLinks(note.text).flatMap((target) => parseReferences(target, resolver)[0]?.refs ?? [])
              : [];
            if (targets.some((ref) => ref.book === book && ref.chapter === chapter)) linked.push(note);
            else if (note.text.toLowerCase().includes(label.toLowerCase())) unlinked.push(note);
          }

          const group = (titleKey, notes) => (notes.length ? h('div', { class: 'result-group' },
            h('div', { class: 'result-head' }, icon('link'), h('span', {}, L(titleKey)), h('span', { class: 'rh-count' }, String(notes.length))),
            notes.map((note) => h('button', {
              class: 'result-line',
              onclick: (e) => shell.openVerse(note.book, note.chapter, note.verse ?? 1, { newTab: wantsNewTab(e) }),
            },
              h('span', { class: 'kbd' }, `${shell.workspace.bookName(note.book)} ${note.chapter}${note.verse ? `:${note.verse}` : ''}`),
              ' ', noteTitle(note.text)))) : null);

          const groups = [group('lbl.linked', linked), group('lbl.unlinked', unlinked)].filter(Boolean);
          body.replaceChildren(...(groups.length ? groups : [h('p', { class: 'empty-hint' }, L('empty.links', { ref: label }))]));
        }

        const offNotes = annotations.on('change', paint);
        const offState = state.subscribe(paint);
        paint();
        return () => { offNotes(); offState(); };
      },
    });
  },
};
