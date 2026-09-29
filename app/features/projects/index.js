/**
 * Study projects: the work a reader is preparing, with the passages in it.
 *
 * The rest of the app answers "what does this verse say" and "what did I think
 * about it". This answers the question those two are usually in service of:
 * *what am I making*. A sermon, a lesson, a small group's six weeks in Romans,
 * a chapter of a thesis — each is a list of passages with writing between them
 * and a few things still to check, and none of that fits in a note attached to
 * one verse.
 *
 * Three things are kept deliberately:
 *
 *  - A passage is stored as a reference, not as copied text. The text is
 *    fetched from whichever translation is being read, so opening the project
 *    in another translation shows that one, and a project written today still
 *    reads correctly after the translation is updated.
 *  - The writing is Markdown, the same as notes, so it can leave in one piece.
 *  - A project is a file. It exports as JSON to come back whole, and as
 *    Markdown to be handed to someone who does not use this app.
 */

import { verseLabelOf } from '../../core/annotations.js';
import { noteTitle } from '../../core/markdown.js';
import {
  addEntry, buildProjectFile, createEntry, createProject, editEntry, moveEntry,
  parseProjectFile, parseShelf, progressOf, removeEntry, toMarkdown,
} from '../../core/projects.js';
import { relativeTime } from '../../core/time.js';
import { downloadJson, pickJson } from '../../services/transfer.js';
import { fill, h, keepPlace } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { openMenu } from '../../shell/menu.js';
import { renderMarkdown } from '../../shell/markdown.js';
import { VERSION } from '../../version.js';

const KEY = 'projects';
const SAVE_DELAY_MS = 500;

export default {
  id: 'projects',
  setup(ctx) {
    const { records, registry, shell, state, store } = ctx;

    let shelf = parseShelf(records.get(KEY, null));
    const listeners = new Set();
    const repaint = () => { for (const fn of listeners) fn(); };

    const openProject = () => shelf.projects.find((p) => p.id === shelf.open) ?? null;

    /** Write the shelf through, then let every view catch up. */
    function keep(next, { quiet = false } = {}) {
      shelf = next;
      records.save(KEY, shelf).catch((err) => shell.notify(err.message, 'error'));
      if (!quiet) repaint();
    }

    /** Change the open project in place. */
    function update(fn, options) {
      const project = openProject();
      if (!project) return;
      const next = fn(project);
      keep({ ...shelf, projects: shelf.projects.map((p) => (p.id === next.id ? next : p)) }, options);
    }

    function start(name) {
      const project = createProject(name);
      keep({ projects: [...shelf.projects, project], open: project.id });
      return project;
    }

    /** What a passage entry is called, in the translation being read. */
    const reference = (entry) => {
      const name = shell.workspace.bookName(entry.book);
      if (entry.verse === null) return `${name} ${shell.workspace.number(entry.chapter)}`;
      return `${name} ${shell.workspace.number(entry.chapter)}:${verseLabelOf(entry, (n) => shell.workspace.number(n))}`;
    };

    /**
     * Put a passage in the open project — starting one if there is none, since
     * a reader who asked to file a passage has said what they want and should
     * not be sent to a different screen to say it again.
     */
    function collect(passage, { announce = true } = {}) {
      if (!openProject()) start(L('proj.first'));
      update((project) => addEntry(project, createEntry({
        kind: 'passage',
        book: passage.book,
        chapter: passage.chapter,
        verse: passage.verse ?? null,
        to: passage.to ?? null,
      })));
      if (announce) {
        shell.notify(L('proj.added', { ref: reference(passage), name: openProject().name }), 'ok', {
          action: { label: L('cmd.open'), run: () => shell.openDoc('projects') },
        });
      }
    }

    // --- getting at it -------------------------------------------------------

    registry.command({
      id: 'projects.open', title: L('doc.projects'), icon: 'files', ribbon: true, opens: 'projects',
      run: () => shell.openDoc('projects'),
    });
    registry.command({
      id: 'projects.new', title: L('proj.new'), icon: 'plus',
      run: () => { start(L('proj.untitled')); shell.openDoc('projects'); },
    });
    registry.command({
      id: 'projects.add', title: L('proj.addHere'), icon: 'plus', needsChapter: true,
      run: () => {
        const { book, chapter } = state.get();
        collect({ book, chapter, verse: null, to: null });
      },
    });
    registry.verseAction({
      id: 'projects.add', title: L('proj.add'), icon: 'plus',
      run: (p) => collect(p),
    });
    registry.verb({
      id: 'projects.verb', word: 'project', title: L('verb.project'), icon: 'files',
      hint: L('verb.projectHint'), run: (p) => collect(p),
    });
    registry.setting({
      id: 'projects.count', section: 'material', order: 20,
      build: (ui) => ui.action({
        name: L('doc.projects'),
        hint: L('proj.settingHint'),
        value: String(shelf.projects.length),
        label: L('cmd.open'), glyph: 'files',
        onClick: () => shell.openDoc('projects'),
      }),
    });

    // --- moving them about ---------------------------------------------------

    function exportJson(project) {
      downloadJson(`${slug(project.name)}.laiproject.json`, buildProjectFile(project, { appVersion: VERSION }));
      shell.notify(L('proj.exported', { name: project.name }));
    }

    function exportMarkdown(project) {
      const text = toMarkdown(project, { reference });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
      const link = h('a', { href: url, download: `${slug(project.name)}.md` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      shell.notify(L('proj.exported', { name: project.name }));
    }

    async function importProject() {
      const file = await pickJson();
      if (!file) return;
      const project = parseProjectFile(file.data, { source: file.name });
      // An imported project never replaces one already here: same-id imports
      // become a second copy, because a file may be an older version of what
      // the reader has been working on all morning.
      const taken = shelf.projects.some((p) => p.id === project.id);
      const landed = taken ? { ...project, id: `${project.id}-${Date.now().toString(36)}` } : project;
      keep({ projects: [...shelf.projects, landed], open: landed.id });
      shell.notify(L('proj.imported', { name: landed.name, n: landed.entries.length }));
    }

    const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    const guard = (fn) => (...args) => Promise.resolve()
      .then(() => fn(...args))
      .catch((err) => shell.notify(err.message, 'error'));

    registry.command({ id: 'projects.import', title: L('proj.import'), icon: 'enter', run: guard(importProject) });

    // --- the page ------------------------------------------------------------

    registry.doc({
      id: 'projects',
      title: L('doc.projects'),
      icon: 'files',
      mount(el) {
        /** Entries whose preview is showing rather than their editor. */
        const previewing = new Set();
        const timers = new Map();

        /** Typing saves itself, a little after the typing stops. */
        function typed(entryId, text) {
          clearTimeout(timers.get(entryId));
          timers.set(entryId, setTimeout(() => {
            update((project) => editEntry(project, entryId, { text }), { quiet: true });
            paintCounts();
          }, SAVE_DELAY_MS));
        }

        function paintCounts() {
          const project = openProject();
          if (!project) return;
          const progress = progressOf(project);
          const foot = el.querySelector('.pj-progress');
          if (foot) foot.textContent = summary(progress);
        }

        const summary = (progress) => [
          L('proj.nPassages', { n: progress.passages }),
          L('proj.nNotes', { n: progress.notes }),
          progress.todo ? L('proj.nTodo', { done: progress.done, n: progress.todo }) : null,
          L('proj.nWords', { n: progress.words }),
        ].filter(Boolean).join(' · ');

        /**
         * The shelf: what there is, and the two ways to get another one.
         *
         * Making a project and bringing one in are a plus and an arrow in
         * every application anybody has used, so they are icons at the head of
         * the list rather than a wide primary button above it and a second
         * button under it. That also stops the shelf from being taller than
         * the thing it lists when there is one project on it.
         */
        function shelfColumn() {
          return h('aside', { class: 'pj-shelf' },
            h('div', { class: 'pj-shelf-head' },
              h('h2', {}, L('doc.projects')),
              h('div', { class: 'pj-shelf-acts' },
                tool('plus', L('proj.new'), () => start(L('proj.untitled'))),
                tool('enter', L('proj.import'), guard(importProject)))),
            shelf.projects.length
              ? h('div', { class: 'pj-list' }, shelf.projects.map((project) => {
                const progress = progressOf(project);
                return h('button', {
                  class: `pj-item${project.id === shelf.open ? ' is-on' : ''}`,
                  onclick: () => keep({ ...shelf, open: project.id }),
                },
                  h('span', { class: 'pj-item-n' }, project.name),
                  h('span', { class: 'pj-item-s' },
                    `${L('proj.nPassages', { n: progress.passages })} · ${relativeTime(project.updated)}`));
              }))
              : h('p', { class: 'muted pj-empty' }, L('proj.none')));
        }

        /**
         * A button that is only its icon. The name is the tooltip and the
         * accessible name, so nothing is lost to somebody who cannot see the
         * glyph or does not recognise it.
         */
        function tool(glyph, label, run, extra = '') {
          return h('button', {
            class: `pj-tool${extra ? ` ${extra}` : ''}`,
            title: label, 'aria-label': label, onclick: run,
          }, icon(glyph));
        }

        /** One entry: a passage with its text, a piece of writing, or a task. */
        function entryCard(project, entry, index) {
          const body = h('div', { class: 'pj-entry-body' });
          const editor = h('textarea', {
            class: 'pj-text scroll', dir: 'auto', spellcheck: 'true',
            placeholder: entry.kind === 'passage' ? L('proj.phInterpret') : L('proj.phNote'),
            oninput: (e) => typed(entry.id, e.currentTarget.value),
          });
          editor.value = entry.text;

          const showPreview = previewing.has(entry.id);
          if (showPreview) {
            body.append(h('div', { class: 'md-body pj-preview' },
              entry.text.trim()
                ? renderMarkdown(entry.text, {
                  resolver: shell.workspace.resolver(),
                  onLink: (ref, options) => (ref.verse
                    ? shell.openVerse(ref.book, ref.chapter, ref.verse, options)
                    : shell.openChapter(ref.book, ref.chapter, options)),
                  onPeek: (ref, anchor) => shell.openPeek(anchor, ref),
                  onTag: () => {},
                })
                : h('p', { class: 'muted' }, L('proj.nothingWritten'))));
          } else {
            body.append(editor);
          }

          const tools = h('div', { class: 'pj-tools' },
            h('button', {
              class: 'pj-tool', title: showPreview ? L('val.write') : L('val.preview'),
              'aria-label': showPreview ? L('val.write') : L('val.preview'),
              onclick: () => {
                if (showPreview) previewing.delete(entry.id); else previewing.add(entry.id);
                paint();
              },
            }, icon(showPreview ? 'edit' : 'eye')),
            h('button', {
              class: 'pj-tool is-up', title: L('proj.moveUp'), 'aria-label': L('proj.moveUp'),
              disabled: index === 0,
              onclick: () => update((p) => moveEntry(p, entry.id, -1)),
            }, icon('chev')),
            h('button', {
              class: 'pj-tool is-down', title: L('proj.moveDown'), 'aria-label': L('proj.moveDown'),
              disabled: index === project.entries.length - 1,
              onclick: () => update((p) => moveEntry(p, entry.id, 1)),
            }, icon('chev')),
            h('button', {
              class: 'pj-tool danger', title: L('cmd.delete'), 'aria-label': L('cmd.delete'),
              onclick: async () => {
                const sure = await shell.confirm({
                  title: L('proj.askRemove'),
                  body: entry.kind === 'passage' ? reference(entry) : noteTitle(entry.text, L('proj.untitledEntry')),
                  confirm: L('cmd.delete'), danger: true,
                });
                if (sure) update((p) => removeEntry(p, entry.id));
              },
            }, icon('trash')));

          const head = entry.kind === 'passage'
            ? h('div', { class: 'pj-entry-head' },
              h('button', {
                class: 'pj-ref', title: L('cmd.goToPassage'),
                onclick: (e) => (entry.verse
                  ? shell.openVerse(entry.book, entry.chapter, entry.verse, { newTab: wantsNewTab(e) })
                  : shell.openChapter(entry.book, entry.chapter, { newTab: wantsNewTab(e) })),
              }, icon('book-open'), reference(entry)),
              tools)
            : h('div', { class: 'pj-entry-head' },
              entry.kind === 'todo'
                ? h('label', { class: 'pj-check' },
                  checkbox(entry),
                  h('span', {}, L('proj.task')))
                : h('span', { class: 'pj-kind' }, icon('note'), L('proj.note')),
              tools);

          const card = h('article', {
            class: `pj-entry pj-${entry.kind}${entry.done ? ' is-done' : ''}`,
            dataset: { kind: entry.kind },
          }, head, body);

          if (entry.kind === 'passage') {
            // The verses themselves, from whichever translation is being read.
            // Fetched rather than stored, and quietly absent when the passage
            // is not in this translation.
            // Hidden until there is something in it: an empty quote box is a
            // shaded strip under the reference that looks like a fault, and
            // there is nothing to quote when the passage is not in the
            // translation being read.
            const quote = h('div', { class: 'pj-quote', hidden: true });
            card.insertBefore(quote, body);
            verses(entry).then((lines) => {
              if (!lines.length) return;
              quote.hidden = false;
              fill(quote, ...lines.map((line) => h('p', { class: 'pj-v', lang: shell.workspace.lang() },
                h('b', {}, shell.workspace.number(line.verse)), ' ', line.text)));
            }).catch(() => { /* a missing quote is not worth a message */ });
          }
          return card;
        }

        function checkbox(entry) {
          const input = h('input', {
            type: 'checkbox', 'aria-label': L('proj.task'),
            onchange: (e) => update((p) => editEntry(p, entry.id, { done: e.currentTarget.checked })),
          });
          input.checked = entry.done;
          return input;
        }

        /** The verses of a passage entry, in the translation being read. */
        async function verses(entry) {
          const { translation } = state.get();
          if (!translation) return [];
          const chapter = await store.getChapter(translation, entry.book, entry.chapter);
          if (!chapter) return [];
          const from = entry.verse ?? 1;
          const to = entry.to ?? (entry.verse ?? Number.MAX_SAFE_INTEGER);
          return Object.keys(chapter).map(Number)
            .filter((n) => n >= from && n <= to)
            .sort((a, b) => a - b)
            .slice(0, 40)
            .map((verse) => ({ verse, text: chapter[verse].text }));
        }

        function projectColumn() {
          const project = openProject();
          if (!project) {
            return h('div', { class: 'pj-main' },
              h('div', { class: 'pj-blank' },
                h('span', { class: 'pj-blank-mark' }, icon('files')),
                h('h2', {}, L('proj.blankTitle')),
                h('p', { class: 'muted' }, L('proj.blankBody')),
                h('button', { class: 'btn primary', onclick: () => start(L('proj.untitled')) },
                  icon('plus'), L('proj.new')),
                // The shelf is not drawn while there is nothing on it, so the
                // other way in has to be here or there is no way in at all.
                h('button', { class: 'pj-quiet', onclick: guard(importProject) }, L('proj.import'))));
          }

          const name = h('input', {
            class: 'pj-name', value: project.name, 'aria-label': L('proj.name'),
            oninput: (e) => {
              const value = e.currentTarget.value;
              clearTimeout(timers.get('name'));
              timers.set('name', setTimeout(() => update((p) => ({ ...p, name: value.trim() || L('proj.untitled') }), { quiet: true }), SAVE_DELAY_MS));
            },
          });

          const summaryBox = h('textarea', {
            class: 'pj-summary', dir: 'auto', placeholder: L('proj.phSummary'),
            oninput: (e) => {
              const value = e.currentTarget.value;
              clearTimeout(timers.get('summary'));
              timers.set('summary', setTimeout(() => update((p) => ({ ...p, summary: value }), { quiet: true }), SAVE_DELAY_MS));
            },
          });
          summaryBox.value = project.summary;

          // One strip, the card studio's manners: the name on the left, what
          // can be added in the middle, what happens to the whole project at
          // the end. The three "Add …" buttons used to sit at the foot of the
          // page — below however many entries there already were, which is
          // exactly where somebody adding a fourth is not looking.
          const bar = h('header', { class: 'pj-bar' },
            name,
            h('div', { class: 'pj-bar-sep' }),
            tool('book-open', L('proj.addHere'), () => {
              const { book, chapter } = state.get();
              collect({ book, chapter, verse: null, to: null }, { announce: false });
            }),
            tool('note', L('proj.addNote'), () => update((p) => addEntry(p, createEntry({ kind: 'text' })))),
            tool('check', L('proj.addTask'), () => update((p) => addEntry(p, createEntry({ kind: 'todo' })))),
            h('div', { class: 'pj-bar-sep' }),
            // Two exports behind one glyph: both are "take this out of here",
            // and a strip is not the place to explain the difference.
            tool('download', L('proj.export'), (e) => openMenu(e.currentTarget, [
              { id: 'md', title: L('proj.asMarkdown'), sub: L('proj.asMarkdownSub'), icon: 'quote', run: () => exportMarkdown(project) },
              { id: 'json', title: L('proj.asFile'), sub: L('proj.asFileSub'), icon: 'files', run: () => exportJson(project) },
            ])),
            tool('trash', L('proj.delete'), async () => {
              const sure = await shell.confirm({
                title: L('proj.askDelete'), body: L('proj.askDeleteBody', { name: project.name }),
                confirm: L('cmd.delete'), danger: true,
              });
              if (!sure) return;
              const left = shelf.projects.filter((p) => p.id !== project.id);
              keep({ projects: left, open: left[0]?.id ?? null });
            }, 'danger'));

          return h('div', { class: 'pj-main' },
            bar,
            h('p', { class: 'pj-progress muted' }, summary(progressOf(project))),
            summaryBox,
            h('div', { class: 'pj-entries' },
              project.entries.length
                ? project.entries.map((entry, i) => entryCard(project, entry, i))
                : h('p', { class: 'muted pj-empty' }, L('proj.noEntries'))));
        }

        function paint() {
          // With nothing on the shelf there is no shelf: a column headed
          // "Projects" saying "No projects yet" beside a page saying the same
          // thing louder is one empty state too many.
          const bare = !shelf.projects.length;
          keepPlace(el, () => fill(el, h('section', { class: 'doc projects' },
            h('div', { class: `pj-layout${bare ? ' is-bare' : ''}` },
              bare ? null : shelfColumn(),
              projectColumn()))));
        }

        listeners.add(paint);
        const offState = state.subscribe(paint);
        paint();
        return () => {
          listeners.delete(paint);
          offState();
          for (const timer of timers.values()) clearTimeout(timer);
        };
      },
    });

    // --- the pane beside the reading -----------------------------------------

    registry.pane({
      id: 'project',
      side: 'right',
      order: 45,
      icon: 'files',
      title: L('pane.project'),
      mount(el) {
        function paint() {
          const project = openProject();
          if (!project) {
            fill(el, h('div', { class: 'pj-pane-blank' },
              h('p', {}, L('proj.blankBody')),
              h('button', { class: 'btn primary', onclick: () => { start(L('proj.untitled')); shell.openDoc('projects'); } },
                icon('plus'), L('proj.new'))));
            return;
          }
          const progress = progressOf(project);
          fill(el, h('div', { class: 'pj-pane' },
            h('button', { class: 'pj-pane-head', onclick: () => shell.openDoc('projects') },
              h('span', { class: 'pj-item-n' }, project.name),
              h('span', { class: 'pj-item-s' }, L('proj.nPassages', { n: progress.passages }))),
            h('div', { class: 'pj-pane-list' }, project.entries.map((entry) => h('button', {
              class: `pj-pane-row pj-${entry.kind}${entry.done ? ' is-done' : ''}`,
              onclick: (e) => (entry.kind === 'passage'
                ? (entry.verse
                  ? shell.openVerse(entry.book, entry.chapter, entry.verse, { newTab: wantsNewTab(e) })
                  : shell.openChapter(entry.book, entry.chapter, { newTab: wantsNewTab(e) }))
                : shell.openDoc('projects')),
            },
              icon(entry.kind === 'passage' ? 'book-open' : entry.kind === 'todo' ? 'check' : 'note'),
              h('span', {}, entry.kind === 'passage' ? reference(entry) : noteTitle(entry.text, L('proj.untitledEntry')))))),
            // The pane is 240 px wide on a good day, so its foot says the
            // short form of what the page's toolbar says with a glyph.
            h('div', { class: 'pj-pane-foot' },
              h('button', {
                class: 'btn', title: L('proj.addHere'),
                onclick: () => {
                  const { book, chapter } = state.get();
                  collect({ book, chapter, verse: null, to: null }, { announce: false });
                },
              }, icon('plus'), L('proj.addShort')))));
        }
        listeners.add(paint);
        const offState = state.subscribe(paint);
        paint();
        return () => { listeners.delete(paint); offState(); };
      },
    });
  },
};
