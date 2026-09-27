/**
 * The notes manager: every note in one table — filter, sort, open in the
 * composer, export one or all as Markdown, delete.
 *
 * Phase 1's columns and its row actions, against the Phase 2 note model: a note
 * belongs to a passage, so the first column is that passage rather than an
 * internal id.
 */

import { verseLabelOf } from '../../core/annotations.js';
import { noteTitle, wordCount } from '../../core/markdown.js';
import { relativeTime } from '../../core/time.js';
import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const SORTS = Object.freeze(['updated', 'created', 'passage', 'length']);

export default {
  id: 'notes-manager',
  setup(ctx) {
    const { annotations, registry, shell, state } = ctx;
    let query = '';
    let sort = 'updated';

    registry.command({ id: 'notes.manager', title: L('doc.notes'), icon: 'notes', opens: 'notes-manager', run: () => shell.openDoc('notes-manager') });

    const passage = (note) => (note.verse === null
      ? `${shell.workspace.bookName(note.book)} ${note.chapter}`
      : `${shell.workspace.bookName(note.book)} ${note.chapter}:${verseLabelOf(note, (n) => shell.workspace.number(n))}`);

    function download(name, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = h('a', { href: url, download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const asMarkdown = (note) => [`## ${passage(note)}`, '', note.text, '', `_${new Date(note.updated).toLocaleString()}_`].join('\n');

    registry.doc({
      id: 'notes-manager',
      title: L('doc.notes'),
      icon: 'notes',
      mount(el) {
        const filter = h('input', { type: 'search', spellcheck: 'false', placeholder: L('ph.filterNotes'), value: query });
        const sorts = SORTS.map((id) => h('button', {
          dataset: { sort: id },
          onclick: () => { sort = id; paint(); },
        }, L(`val.sort.${id}`)));
        const exportAll = h('button', { class: 'nm-tool', title: L('cmd.exportNotes'), 'aria-label': L('cmd.exportNotes') }, icon('download'));
        const subtitle = h('div', { class: 'note-sub' });
        const list = h('div', { class: 'nm-list' });

        el.append(
          h('div', { class: 'nm' },
            h('h1', { class: 'inline-title' }, L('doc.notes')),
            subtitle,
            h('div', { class: 'nm-tools' },
              h('div', { class: 'field' }, icon('search'), filter),
              h('div', { class: 'rp-seg' }, sorts),
              h('span', { style: { flex: '1' } }),
              exportAll),
            h('div', { class: 'nm-head' },
              h('span', {}, L('lbl.passage')),
              h('span', {}, L('lbl.title')),
              h('span', {}, L('lbl.chapter')),
              h('span', {}, L('lbl.updated')),
              h('span', {}, '#'),
              h('span', {})),
            list));

        function ordered(notes) {
          const by = {
            updated: (a, b) => Date.parse(b.updated) - Date.parse(a.updated),
            created: (a, b) => Date.parse(b.created) - Date.parse(a.created),
            passage: (a, b) => a.book - b.book || a.chapter - b.chapter || (a.verse ?? 0) - (b.verse ?? 0),
            length: (a, b) => b.text.length - a.text.length,
          };
          return [...notes].sort(by[sort]);
        }

        function matches(note) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return `${passage(note)} ${note.text}`.toLowerCase().includes(q);
        }

        /** The note's headings, or its first line, as the row's second line. */
        function gist(note) {
          const headings = note.text.split('\n')
            .map((line) => /^#{1,4}\s+(.+)$/.exec(line))
            .filter(Boolean)
            .map((m) => m[1].replace(/[*`_[\]]/g, '').trim())
            .filter(Boolean);
          const text = headings.length ? headings.join('  ·  ') : (note.text.split('\n').find((l) => l.trim()) ?? '');
          return text.slice(0, 90);
        }

        function row(note) {
          const open = () => {
            state.set({ noteFor: note.verse, noteTo: note.to ?? null });
            shell.openVerse(note.book, note.chapter, note.verse ?? 1);
            shell.run('composer.open');
          };
          return h('div', { class: 'nm-row', dataset: { note: note.id } },
            h('span', { class: 'nm-id', title: passage(note) }, passage(note)),
            h('span', { class: 'nm-title' }, noteTitle(note.text, passage(note)), h('span', { class: 'nm-sub' }, gist(note))),
            h('span', {}, h('button', { class: 'pill', onclick: (e) => shell.openChapter(note.book, note.chapter, { newTab: wantsNewTab(e) }) },
              `${shell.workspace.bookName(note.book)} ${note.chapter}`)),
            h('span', { class: 'nm-when' }, relativeTime(note.updated)),
            h('span', { class: 'nm-words' }, String(wordCount(note.text))),
            h('span', { class: 'nm-acts' },
              h('button', { title: L('cmd.edit'), 'aria-label': L('cmd.edit'), onclick: open }, icon('edit')),
              h('button', {
                title: L('cmd.exportNote'),
                'aria-label': L('cmd.exportNote'),
                onclick: () => {
                  download(`${passage(note).replace(/[\s:]+/g, '-')}.md`, asMarkdown(note));
                  shell.notify(L('msg.notesExported', { n: 1 }));
                },
              }, icon('download')),
              h('button', {
                class: 'danger',
                title: L('cmd.delete'),
                'aria-label': L('cmd.delete'),
                onclick: () => annotations.deleteNote(note.id).catch((err) => shell.notify(err.message, 'error')),
              }, icon('trash'))));
        }

        function paint() {
          const all = annotations.allNotes();
          const shown = ordered(all.filter(matches));
          subtitle.textContent = `${L('lbl.notesCount', { n: all.length })} · ${L('lbl.words', { n: all.reduce((n, x) => n + wordCount(x.text), 0) })}`;
          for (const button of sorts) button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
          list.replaceChildren(...(shown.length
            ? shown.map(row)
            : [h('p', { class: 'empty-hint' }, all.length ? L('empty.noNoteHits') : L('empty.notes'))]));
        }

        filter.addEventListener('input', () => { query = filter.value; paint(); });
        exportAll.addEventListener('click', () => {
          const all = annotations.allNotes();
          if (!all.length) { shell.notify(L('empty.notes'), 'error'); return; }
          const text = [`# ${L('doc.notes')}`, '', ...ordered(all).map(asMarkdown)].join('\n\n');
          download(`lai-siangtho-notes-${new Date().toISOString().slice(0, 10)}.md`, text);
          shell.notify(L('msg.notesExported', { n: all.length }));
        });

        const off = annotations.on('change', paint);
        paint();
        return off;
      },
    });
  },
};
