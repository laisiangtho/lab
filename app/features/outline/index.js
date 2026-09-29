/**
 * Outline: where this edition says a passage begins.
 *
 * It was the headings of the chapter in view, which is a way to jump inside a
 * long chapter and no help at all with "where is the good shepherd". A heading
 * index is the same list at a different scope, so the scope is a control
 * rather than a second pane: this chapter, this book, or the whole translation,
 * with a filter once the list is longer than a screen.
 *
 * Both kinds of heading are one list. `story` is the pericope heading the
 * edition publishes and `verse.title` is a sub-heading written on the verse;
 * to somebody looking for where a passage starts that difference is a detail,
 * kept as `level` so they can be drawn apart and never as two lists to search
 * separately.
 *
 * The whole translation means every chapter, which is a cursor over the store
 * — the same walk search makes, a second or so. So it is fetched when asked
 * for, cached until the translation changes, and abandoned the moment the
 * answer stops being wanted.
 */

import { headingsOf } from '../../core/examine.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { L } from '../../shell/i18n.js';

const KEY = 'outline';
/** Each scope, and the glyph that stands for it in a 240px pane. */
const SCOPES = Object.freeze([
  ['chapter', 'lay-list'],
  ['book', 'book'],
  ['all', 'library'],
]);
/** Rows drawn before the list is cut; a filter is how the rest is reached. */
const LIMIT = 400;

export default {
  id: 'outline',
  setup(ctx) {
    const { annotations, category, records, registry, shell, state, store } = ctx;

    registry.pane({
      id: 'outline',
      side: 'right',
      order: 5,
      // Not `info`, which is what "about this thing" wears everywhere else in
      // the app, and which this pane only had because it is the registry's
      // fallback. An outline is a list of headings.
      icon: 'lay-list',
      title: L('pane.outline'),
      mount(el) {
        const held = records.get(KEY, null) ?? {};
        let scope = SCOPES.some(([id]) => id === held.scope) ? held.scope : 'chapter';
        let query = '';
        /** The wide answer, and what it was computed from. */
        let wide = null;
        let wideFor = '';
        let token = 0;

        const filter = h('input', {
          type: 'search', class: 'ol-filter', placeholder: L('ol.filter'),
          'aria-label': L('ol.filter'), spellcheck: 'false',
          oninput: (e) => { query = e.currentTarget.value; draw(); },
        });
        const tabs = h('div', { class: 'ol-scope', role: 'tablist' });
        const body = h('div', { class: 'stack ol-body' });
        el.append(h('div', { class: 'ol-tools' }, tabs, filter), body);

        function paintScope() {
          fill(tabs, ...SCOPES.map(([id, glyph]) => h('button', {
            class: `ol-tab${id === scope ? ' is-on' : ''}`,
            role: 'tab', 'aria-selected': String(id === scope),
            title: L(`ol.${id}`), 'aria-label': L(`ol.${id}`),
            onclick: () => {
              if (scope === id) return;
              scope = id;
              records.save(KEY, { ...(records.get(KEY, null) ?? {}), scope })
                .catch(() => { /* a remembered scope is not worth a message */ });
              run();
            },
          }, icon(glyph))));
        }

        /** The headings this scope asks for, and where they came from. */
        async function gather(run) {
          const { translation, book, chapter } = state.get();
          if (!translation) return { state: 'none' };
          const meta = await store.getMeta(translation);
          if (run !== token) return { state: 'stale' };

          if (scope === 'chapter') {
            const verses = await store.getChapter(translation, book, chapter);
            if (run !== token) return { state: 'stale' };
            if (!verses) return { state: 'empty', meta, verses: null };
            return {
              state: 'ok',
              meta,
              verses,
              rows: headingsOf({ story: meta.story?.[book]?.[chapter], verses, book, chapter }),
            };
          }

          // One book or all of them: the same walk, a different range, and the
          // answer kept so switching back and forth is free.
          const want = `${translation}:${scope}:${scope === 'book' ? book : ''}`;
          if (wideFor !== want) {
            const rows = [];
            await store.scanChapters(translation, (row) => {
              rows.push(...headingsOf({
                story: meta.story?.[row.book]?.[row.chapter],
                verses: row.verses,
                book: row.book,
                chapter: row.chapter,
              }));
            }, { books: scope === 'book' ? [book] : null, while: () => run === token });
            if (run !== token) return { state: 'stale' };
            rows.sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
            wide = rows;
            wideFor = want;
          }
          return { state: 'ok', meta, rows: wide };
        }

        let last = { state: 'none' };

        function draw() {
          const { state: how, meta, verses, rows = [] } = last;
          // Nothing to outline and nothing to scope: the controls would be
          // three tabs and a search box over an apology.
          el.firstElementChild.hidden = how === 'none';
          if (how === 'none') { fill(body, h('p', { class: 'empty-hint' }, L('msg.noTranslations'))); return; }
          if (how === 'loading') { fill(body, h('p', { class: 'empty-hint' }, L('ol.reading'))); return; }
          if (how === 'empty') { fill(body, h('p', { class: 'empty-hint' }, L('ch.noText', { tr: meta.info.shortname }))); return; }

          const wanted = query.trim().toLowerCase();
          const shown = wanted ? rows.filter((row) => row.text.toLowerCase().includes(wanted)) : rows;
          const cut = shown.length > LIMIT;

          const head = scope === 'chapter' && verses ? chapterFacts(verses) : countLine(rows.length, shown.length);

          fill(body, head, ...(shown.length
            ? shown.slice(0, LIMIT).map((row) => h('button', {
              class: `outline-row level-${row.level}`,
              title: shell.workspace.englishRef(row.book, row.chapter),
              onclick: (e) => shell.openVerse(row.book, row.chapter, row.verse, { newTab: wantsNewTab(e) }),
            },
              // Wider than a chapter, the reference is the canon's short name
              // and the numbers — "Ps 23:1" rather than "Salmernes Bog 23:1",
              // which took half the row and left the heading, the thing being
              // looked for, in a column two words wide.
              h('span', { class: 'kbd' }, scope === 'chapter'
                ? String(row.verse)
                : `${category.book(row.book).shortname} ${shell.workspace.number(row.chapter)}:${shell.workspace.number(row.verse)}`),
              ' ', row.text))
            : [h('p', { class: 'empty-hint' }, wanted ? L('ol.noMatch', { what: query.trim() }) : L('empty.outline'))]),
          cut ? h('p', { class: 'empty-hint' }, L('ol.cut', { n: shown.length - LIMIT })) : null);
        }

        /** What the chapter in view holds, which is the old pane's header. */
        function chapterFacts(verses) {
          const { book, chapter } = state.get();
          const { notes, marks } = annotations.forChapter(book, chapter);
          return h('div', { class: 'card' },
            h('h4', {}, `${shell.workspace.bookName(book)} ${shell.workspace.number(chapter)}`),
            h('p', {}, [
              L('lbl.verses', { n: Object.keys(verses).length }),
              notes.length ? L('lbl.notes', { n: notes.length }) : null,
              marks.length ? L('lbl.marks', { n: marks.length }) : null,
            ].filter(Boolean).join(' · ')));
        }

        const countLine = (total, shown) => h('p', { class: 'ol-count' },
          shown === total ? L('ol.count', { n: total }) : L('ol.countOf', { n: shown, total }));

        async function paint() {
          const run = ++token;
          paintScope();
          if (scope !== 'chapter' && wideFor !== `${state.get().translation}:${scope}:${scope === 'book' ? state.get().book : ''}`) {
            last = { state: 'loading' };
            draw();
          }
          const next = await gather(run);
          if (next.state === 'stale' || run !== token) return;
          last = next;
          draw();
        }

        const run = () => paint().catch((err) => shell.notify(err.message, 'error'));
        const offState = state.subscribe(() => {
          // A chapter step does not change a book-wide or whole-translation
          // answer unless the book or the translation changed with it.
          run();
        });
        const offNotes = annotations.on('change', run);
        const offLibrary = ctx.library.on('change', () => { wideFor = ''; run(); });
        run();
        return () => { token += 1; offState(); offNotes(); offLibrary(); };
      },
    });
  },
};
