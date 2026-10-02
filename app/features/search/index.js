/**
 * Search: full text across the translations that are available offline.
 *
 * The scan runs in a worker and results stream in, so the first hits appear
 * while the rest is still being read. Typing replaces the running query.
 *
 * What a reader gets back is a shape, not a list: how many verses matched, in
 * how many chapters and books, and then those books as a tree they can open.
 * A common word matches thousands of verses, and a flat list of the first forty
 * of them says nothing about where the rest are.
 *
 * What is searched is theirs to decide — which translations, which testaments,
 * sections or books — and how it is matched: plainly, on whole words, or as a
 * regular expression, with case folded or not. Every choice is remembered.
 */

import { fill, h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const DEBOUNCE_MS = 220;
/** Rows kept for display. Counting carries on past this; only the list stops. */
const LIMIT = 2000;
/** Up to this many hits, the tree opens itself; beyond it, books stay shut. */
const OPEN_ALL_BELOW = 60;
const KEY = 'search';

export default {
  id: 'search',
  setup(ctx) {
    const { category, records, registry, search, shell, store } = ctx;
    let focusInput = null;

    registry.command({
      id: 'search.open',
      title: L('cmd.search'),
      icon: 'search',
      keys: 'Mod+f',
      ribbon: true,
      run: () => { shell.selectPane('left', 'search'); focusInput?.(); },
    });

    /**
     * What a search assumes before anything is typed. The pane keeps these as
     * the reader leaves them, so this is where to change them without running a
     * search first — and where to see what the pane is currently set to.
     */
    registry.setting({
      id: 'search.defaults',
      section: 'study',
      order: 20,
      build: (ui) => {
        const held = records.get(KEY, null) ?? {};
        const patch = (next) => {
          // Re-read rather than reuse `held`: the pane writes the same record,
          // and a patch built on a snapshot taken when this page was drawn
          // would put the pane's later choices back to what they were.
          const now = records.get(KEY, null) ?? {};
          records.save(KEY, { mode: 'terms', matchCase: false, translations: [], books: null, ...now, ...next })
            .then(() => ui.refresh())
            .catch(() => { /* a default is not worth a message */ });
        };
        return [
          ui.choice({
            name: L('set.searchMode'),
            hint: L('set.searchModeHint'),
            options: [['terms', L('val.anywhere')], ['word', L('val.wholeWord')], ['regex', L('val.regex')]],
            value: held.mode ?? 'terms',
            onChange: (mode) => patch({ mode }),
          }),
          ui.toggle({
            name: L('find.matchCase'),
            hint: L('set.searchCaseHint'),
            value: held.matchCase === true,
            onChange: (on) => patch({ matchCase: on }),
          }),
          ui.action({
            name: L('set.searchScope'),
            hint: (held.translations?.length ? L('set.scopeTranslations', { n: held.translations.length }) : L('set.scopeAllTranslations'))
              + ' · '
              + (held.books?.length ? L('set.scopeBooks', { n: held.books.length }) : L('set.scopeWholeCanon')),
            label: L('cmd.reset'),
            glyph: 'undo',
            disabled: !held.translations?.length && !held.books?.length,
            onClick: () => patch({ translations: [], books: null }),
          }),
        ];
      },
    });

    let runQuery = null;
    registry.verb({
      id: 'search.verb',
      word: 'find',
      title: L('verb.find'),
      takes: 'text',
      icon: 'search',
      hint: L('verb.findHint'),
      run: (text) => {
        shell.selectPane('left', 'search');
        // The pane may have just been mounted by that call, so the query goes
        // in on the next frame, when there is something to put it in.
        requestAnimationFrame(() => { runQuery?.(text); });
      },
    });

    registry.pane({
      id: 'search',
      side: 'left',
      order: 20,
      icon: 'search',
      title: L('pane.search'),
      mount(el) {
        const held = records.get(KEY, null) ?? {};
        /**
         * How to match, as two independent switches rather than three modes:
         * whole words on or off, and a regular expression on or off. A pattern
         * states its own boundaries, so the word switch is not offered with it.
         */
        let wholeWord = held.mode === 'word';
        let regex = held.mode === 'regex';
        let matchCase = held.matchCase === true;
        const modeOf = () => (regex ? 'regex' : wholeWord ? 'word' : 'terms');
        /** What to search: translations by id, books by id (null = the whole canon). */
        let translations = Array.isArray(held.translations) ? held.translations : [];
        let books = Array.isArray(held.books) && held.books.length ? held.books : null;
        /** Which branches of the result tree are open. */
        const open = new Set();
        /** The results so far: book → chapter → rows. */
        let found = new Map();
        /** Every book that matched, with its true counts — including the ones
         *  whose verses were past the display limit. */
        let shape = new Map();
        let counts = null;
        let running = false;
        let filling = null;
        /** Which query the results on screen belong to; see `fillBook`. */
        let generation = 0;
        /** The translations the results on screen came from. */
        let searching = [];

        /** True while this pane's own write is in flight, so it ignores it. */
        let writing = false;
        const remember = () => {
          writing = true;
          return records.save(KEY, { mode: modeOf(), matchCase, translations, books })
            .catch(() => { /* a filter is not worth a message */ })
            .finally(() => { writing = false; });
        };

        /**
         * This record has two writers — this pane and the Settings page — and
         * `records.save` replaces the whole value. Without this, changing the
         * scope in Settings left the pane searching the old scope, and the
         * pane's next write put the old scope back into Settings.
         */
        function reread() {
          const now = records.get(KEY, null) ?? {};
          wholeWord = now.mode === 'word';
          regex = now.mode === 'regex';
          matchCase = now.matchCase === true;
          translations = Array.isArray(now.translations) ? now.translations : [];
          books = Array.isArray(now.books) && now.books.length ? now.books : null;
          paintModes();
          paintScopeLabel();
        }

        // --- the query -------------------------------------------------------

        // The device's own helpers stay out of a search for scripture's words.
        const input = h('input', {
          type: 'search', spellcheck: 'false', placeholder: L('ph.search'), 'aria-label': L('ph.search'),
          autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', enterkeyhint: 'search',
        });
        const status = h('p', { class: 'empty-hint' }, L('empty.search'));
        const tree = h('div', { class: 'search-results' });
        const filters = h('div', { class: 'search-filters', hidden: true });
        const scopeButton = h('button', {
          class: 'sf-toggle', 'aria-expanded': 'false',
          onclick: () => { filters.hidden = !filters.hidden; scopeButton.setAttribute('aria-expanded', String(!filters.hidden)); paintFilters(); },
        }, icon('files'), h('span', { class: 'sf-scope' }), icon('chev'));

        /**
         * The three switches live in the field itself, at the end of the line
         * they act on, rather than in a row of their own under it. They appear
         * when the field is pointed at or typed in, and stay on show whenever
         * one of them is on, so a search that behaves unusually always says so.
         */
        const flag = (name, label, hint, read, write) => {
          const button = h('button', {
            class: 'sm-btn', dataset: { flag: name }, title: hint, 'aria-label': hint,
            'aria-pressed': String(read()),
            // The field keeps the caret: pressing a switch is not leaving the query.
            onmousedown: (e) => e.preventDefault(),
            onclick: () => { write(!read()); paintModes(); remember(); run(); },
          }, label);
          return button;
        };

        const flags = h('div', { class: 'search-flags' },
          flag('word', 'ab|', L('find.modeWord'), () => wholeWord, (on) => { wholeWord = on; }),
          flag('regex', '.*', L('find.modeRegex'), () => regex, (on) => { regex = on; }),
          flag('case', 'Aa', L('find.matchCase'), () => matchCase, (on) => { matchCase = on; }));

        /**
         * The pane says what it is doing: `data-state` is "searching" while a
         * scan is running, and `data-run` counts the scans that have finished.
         * A reader sees the message; anything watching the page — a style, a
         * test — can tell a finished answer from the one still on screen.
         */
        const pane = h('div', { class: 'search-pane', dataset: { state: 'idle', run: '0' } },
          h('div', { class: 'field search-field' }, icon('search'), input, flags),
          scopeButton,
          filters,
          status,
          tree);
        el.append(pane);

        let runs = 0;
        const settle = () => {
          running = false;
          runs += 1;
          pane.dataset.state = 'idle';
          pane.dataset.run = String(runs);
        };

        focusInput = () => { input.focus(); input.select(); };
        // What the palette's "find" verb types into this pane for the reader.
        runQuery = (text) => { input.value = text; input.focus(); run(); };

        function paintModes() {
          const state = { word: wholeWord, regex, case: matchCase };
          for (const button of flags.children) {
            button.setAttribute('aria-pressed', String(state[button.dataset.flag]));
          }
          // A pattern carries its own boundaries; offering whole words beside it
          // would promise something the pattern decides for itself.
          const word = flags.querySelector('[data-flag="word"]');
          word.disabled = regex;
          word.title = regex ? L('find.wordWithRegex') : L('find.modeWord');
          // Shown while the field is in use, and whenever a switch is on.
          flags.dataset.on = String(wholeWord || regex || matchCase);
        }

        // --- what is searched ------------------------------------------------

        /** Installed translations, with the ones this search covers marked. */
        async function scope() {
          const installed = await store.list();
          const chosen = translations.filter((id) => installed.some((t) => t.identify === id));
          // Nothing chosen means the one being read, which is what a reader who
          // has never opened the filters expects.
          const active = chosen.length ? chosen : [ctx.state.get().translation].filter(Boolean);
          return { installed, chosen, active };
        }

        function scopeLabel(installed, chosen) {
          const where = books ? L('find.booksChosen', { n: books.length }) : L('find.wholeBible');
          const what = chosen.length === 0 ? L('find.thisTranslation')
            : chosen.length === installed.length ? L('find.allTranslations', { n: installed.length })
              : L('find.someTranslations', { n: chosen.length });
          return `${what} · ${where}`;
        }

        /** The one-line summary on the button that opens the filters. */
        async function paintScopeLabel() {
          const { installed, chosen } = await scope();
          const label = scopeLabel(installed, chosen);
          scopeButton.querySelector('.sf-scope').textContent = label;
          scopeButton.title = label;
          scopeButton.setAttribute('aria-label', `${L('lbl.scope')}: ${label}`);
        }

        /**
         * Both lists work the same way: what is chosen shows as chips, and a
         * field beside them filters the rest. A checkbox for each of sixty-odd
         * translations would be a column of scrolling nothing; a chip for each
         * of the two in use, and a field to find the third, is the same choice
         * in a tenth of the room.
         */
        const picker = (name, { placeholder, onFilter }) => {
          const chips = h('div', { class: 'sf-chips sf-chosen' });
          const field = h('input', {
            type: 'search', spellcheck: 'false', placeholder, 'aria-label': placeholder,
            oninput: () => onFilter(),
            onfocus: () => { list.dataset.open = 'true'; onFilter(); },
            onblur: () => { setTimeout(() => { list.dataset.open = 'false'; }, 120); },
          });
          const list = h('div', { class: 'sf-list scroll', dataset: { open: 'false', name } });
          const element = h('div', { class: 'sf-block' }, chips, h('div', { class: 'field' }, icon('search'), field), list);
          return { element, chips, field, list };
        };

        const bookPick = picker('books', { placeholder: L('find.books'), onFilter: () => paintBooks() });
        const trPick = picker('translations', { placeholder: L('find.inTranslations'), onFilter: () => paintTranslations() });

        /** A chip for something chosen, with the way to remove it on it. */
        const chosenChip = (label, title, onRemove) => h('button', {
          class: 'sf-chip is-chosen', title: `${title} — ${L('cmd.close')}`, 'aria-label': `${title} — ${L('cmd.close')}`,
          onclick: onRemove,
        }, h('span', {}, label), icon('x'));

        async function paintFilters() {
          if (filters.hidden) { await paintScopeLabel(); return; }

          const quick = (label, value) => h('button', {
            class: 'sf-chip', 'aria-pressed': String(sameBooks(value)),
            onclick: () => { books = value; remember(); paintFilters(); run(); },
          }, label);

          const testamentChips = category.testaments.map((t) => quick(
            t.name, category.books.filter((b) => b.testament === t.id).map((b) => b.id),
          ));
          const sectionChips = category.sections.map((s) => quick(
            s.name, category.books.filter((b) => b.section === s.id).map((b) => b.id),
          ));

          fill(filters,
            trPick.element,
            h('div', { class: 'sf-block' },
              // The four a reader reaches for, then the canon's own sections,
              // set quieter so the common choices are found first.
              h('div', { class: 'sf-chips' },
                quick(L('find.wholeBible'), null),
                quick(L('find.thisBook'), [ctx.state.get().book]),
                ...testamentChips),
              h('div', { class: 'sf-chips is-quiet' }, ...sectionChips)),
            bookPick.element);
          await paintTranslations();
          paintBooks();
          await paintScopeLabel();
        }

        /** The translations in scope as chips, and the rest as a filtered list. */
        async function paintTranslations() {
          const { installed, chosen } = await scope();
          const q = trPick.field.value.trim().toLowerCase();
          const name = (t) => `${t.info.shortname} · ${t.info.name}`;

          fill(trPick.chips,
            chosen.length
              ? chosen.map((id) => {
                const t = installed.find((x) => x.identify === id);
                return chosenChip(t ? t.info.shortname : id, t ? name(t) : id, () => {
                  translations = chosen.filter((x) => x !== id);
                  remember();
                  paintTranslations();
                  paintScopeLabel();
                  run();
                });
              })
              : h('span', { class: 'sf-note' }, L('find.noneChosen')),
            chosen.length && chosen.length < installed.length
              ? h('button', {
                class: 'sf-chip', onclick: () => {
                  translations = installed.map((t) => t.identify);
                  remember();
                  paintTranslations();
                  paintScopeLabel();
                  run();
                },
              }, L('find.addAll', { n: installed.length - chosen.length }))
              : null);

          const rows = installed
            .filter((t) => !chosen.includes(t.identify))
            .filter((t) => !q || `${t.identify} ${name(t)} ${t.info.language.text}`.toLowerCase().includes(q))
            .map((t) => h('button', {
              class: 'sf-row', title: `${name(t)} · ${t.info.language.text}`,
              onmousedown: (e) => e.preventDefault(),
              onclick: () => {
                translations = [...chosen, t.identify];
                trPick.field.value = '';
                remember();
                paintTranslations();
                paintScopeLabel();
                run();
              },
            }, h('span', {}, name(t)), h('span', { class: 'sf-row-sub' }, t.info.language.text)));
          fill(trPick.list, rows.length ? rows : h('p', { class: 'muted sf-note' }, L('empty.match')));
        }

        /**
         * The canon as a list, filtered by whatever is typed. What is chosen
         * shows as chips above it, so a scope of three books is readable without
         * scrolling sixty-three unchecked ones.
         */
        function paintBooks() {
          const q = bookPick.field.value.trim().toLowerCase();
          const chosen = books ? new Set(books) : null;
          const name = (id) => shell.workspace.bookName(id);

          // No books chosen and every book chosen are the same scope — the
          // whole canon — and both are recorded as "no restriction".
          const setBooks = (next) => {
            books = next.size === 0 || next.size === category.books.length
              ? null
              : [...next].sort((x, y) => x - y);
            remember();
            paintBooks();
            paintScopeLabel();
            run();
          };

          fill(bookPick.chips,
            chosen
              ? [...chosen].sort((a, b) => a - b).map((id) => chosenChip(name(id), shell.workspace.englishBook(id), () => {
                const next = new Set(chosen);
                next.delete(id);
                setBooks(next);
              }))
              : h('span', { class: 'sf-note' }, L('find.allBooks')));

          const rows = category.books
            .filter((b) => !chosen || !chosen.has(b.id))
            .filter((b) => !q || name(b.id).toLowerCase().includes(q) || b.name.toLowerCase().includes(q)
              || b.abbr.some((a) => a.toLowerCase().startsWith(q)))
            .map((b) => h('button', {
              // A book the translation being read does not carry is still
              // listed — another translation in scope may have it — and marked
              // the same way the books tree marks it.
              class: `sf-row${shell.workspace.hasBook(b.id) ? '' : ' is-absent'}`,
              title: shell.workspace.hasBook(b.id) ? b.name : `${b.name} — ${L('lbl.notInTranslation')}`,
              onmousedown: (e) => e.preventDefault(),
              onclick: () => {
                const next = new Set(chosen ?? []);
                next.add(b.id);
                bookPick.field.value = '';
                setBooks(next);
              },
            // The canon's name is the sub-line only when it says something the
            // label does not.
            }, h('span', { lang: shell.workspace.lang() }, name(b.id)),
            name(b.id) === b.name ? null : h('span', { class: 'sf-row-sub' }, b.name)));
          fill(bookPick.list, rows.length ? rows : h('p', { class: 'muted sf-note' }, L('empty.match')));
        }

        const sameBooks = (value) => (value === null
          ? books === null
          : Boolean(books) && books.length === value.length && value.every((id) => books.includes(id)));

        // --- running a search -------------------------------------------------

        let timer = null;
        let paintTimer = null;

        async function run() {
          const query = input.value.trim();
          generation += 1;
          found = new Map();
          shape = new Map();
          counts = null;
          filling = null;
          open.clear();
          tree.replaceChildren();
          if (!query) { search.cancel(); status.replaceChildren(L('empty.search')); settle(); return; }

          const { active } = await scope();
          if (!active.length) { status.replaceChildren(L('msg.noTranslations')); settle(); return; }

          running = true;
          searching = active;
          pane.dataset.state = 'searching';
          status.replaceChildren(L('msg.searching'));
          try {
            const summary = await search.run({
              query, translations: active, books, limit: LIMIT,
              options: { mode: modeOf(), matchCase },
              onBatch: (rows, live) => { collect(rows); counts = live; schedulePaint(); },
            });
            if (summary.cancelled) return;
            settle();
            counts = summary;
            shape = new Map(summary.byBook.map((b) => [b.book, b]));
            paint();
            paintStatus(summary, query);
          } catch (err) {
            settle();
            // A regular expression that does not compile is the reader's to fix,
            // and the message says what is wrong with it.
            fill(status, h('span', { class: 'search-bad' }, icon('alert'), err.message));
          }
        }

        function collect(rows) {
          for (const row of rows) {
            let book = found.get(row.book);
            if (!book) { book = new Map(); found.set(row.book, book); }
            const chapter = book.get(row.chapter) ?? [];
            chapter.push(row);
            book.set(row.chapter, chapter);
          }
        }

        /** Repaint at most once a frame while results stream in. */
        function schedulePaint() {
          if (paintTimer) return;
          paintTimer = requestAnimationFrame(() => { paintTimer = null; paint(); paintStatus(counts); });
        }

        function paintStatus(summary, query = input.value.trim()) {
          if (!summary) return;
          if (summary.verses === 0) {
            // The time is printed even when nothing matched: it says the scan
            // ran and got to the end, rather than that it is still going.
            fill(status,
              running ? L('msg.searching') : L('empty.noHits', { query }),
              running || summary.ms === undefined ? null : h('span', { class: 'sr-time' }, `${summary.ms} ms`));
            return;
          }
          const parts = [
            L('find.verses', { n: summary.verses }),
            L('find.inChapters', { n: summary.chapters }),
            L('find.inBooks', { n: summary.books }),
          ];
          fill(status,
            h('span', { class: 'sr-count' }, parts.join(' · ')),
            summary.ms === undefined || running ? null : h('span', { class: 'sr-time' }, `${summary.ms} ms`),
            summary.truncated ? h('span', { class: 'sr-more' }, L('find.showing', { n: summary.shown })) : null);
        }

        /**
         * The results as a tree of books and chapters. Few enough hits and it
         * opens itself; a great many and the books stay shut, because the
         * answer to "how many times does the word appear" is the counts, and
         * the verses are there for whoever wants them.
         */
        function paint() {
          const total = counts?.verses ?? 0;
          const openAll = total > 0 && total <= OPEN_ALL_BELOW;
          const nodes = [];
          // Every book that matched is listed, whether or not its verses were
          // among the ones kept: the tree is the answer's shape, and a book
          // missing from it would read as a book with no hits in it.
          const manyTranslations = searching.length > 1;
          const order = shape.size
            ? [...shape.keys()].sort((a, b) => a - b)
            : [...found.keys()].sort((a, b) => a - b);
          for (const bookId of order) {
            const chapters = found.get(bookId) ?? new Map();
            const key = `b${bookId}`;
            const isOpen = open.has(key) || (openAll && !open.has(`!${key}`));
            const held = [...chapters.values()].reduce((n, rows) => n + rows.length, 0);
            const verses = shape.get(bookId)?.verses ?? held;
            const children = [];
            if (isOpen && held < verses && !running && filling !== bookId) fillBook(bookId);
            if (isOpen && !chapters.size) {
              children.push(h('p', { class: 'sr-loading' }, L('msg.searching')));
            }
            if (isOpen) {
              for (const [chapterId, rows] of [...chapters.entries()].sort((a, b) => a[0] - b[0])) {
                const chapterKey = `${key}.${chapterId}`;
                const chapterOpen = open.has(chapterKey) || (openAll && !open.has(`!${chapterKey}`));
                children.push(h('div', { class: `sr-chapter${chapterOpen ? ' is-open' : ''}` },
                  h('button', {
                    class: 'sr-head sr-ch', title: shell.workspace.englishRef(bookId, chapterId),
                    onclick: () => { toggle(chapterKey, chapterOpen); paint(); },
                  },
                    h('span', { class: 'twisty' }, icon('chev')),
                    h('span', { lang: shell.workspace.lang() }, shell.workspace.number(chapterId)),
                    h('span', { class: 'sr-n' }, String(rows.length))),
                  chapterOpen ? h('div', {}, rows.map((row) => line(row, manyTranslations))) : null));
              }
            }
            nodes.push(h('div', { class: `sr-book${isOpen ? ' is-open' : ''}` },
              h('button', {
                class: 'sr-head', title: shell.workspace.englishBook(bookId),
                onclick: () => { toggle(key, isOpen); paint(); },
              },
                h('span', { class: 'twisty' }, icon('chev')),
                h('span', { class: 'sr-name', lang: shell.workspace.lang() }, shell.workspace.bookName(bookId)),
                h('span', { class: 'sr-n' }, String(verses))),
              ...children));
          }
          fill(tree, nodes);
        }

        /**
         * A book whose verses were past the display limit is searched again on
         * its own when the reader opens it. One book is a fraction of the work
         * the whole scan was, and it beats keeping tens of thousands of lines
         * in memory against the chance that someone opens that book.
         */
        async function fillBook(bookId) {
          if (running || filling !== null) return;
          filling = bookId;
          // Which query this scan is for. Starting a new search cancels the
          // worker job but not this function, which then resumed and poured a
          // previous word's verses into the new word's tree.
          const mine = generation;
          try {
            const { active } = await scope();
            const rows = [];
            await search.run({
              query: input.value.trim(), translations: active, books: [bookId], limit: LIMIT,
              options: { mode: modeOf(), matchCase },
              onBatch: (batch) => rows.push(...batch),
            });
            if (mine !== generation) return;
            found.delete(bookId);
            collect(rows);
          } catch {
            /* the message for a bad query has already been shown */
          } finally {
            if (mine === generation) { filling = null; paint(); }
          }
        }

        /** Open state is remembered per branch, including a branch shut by hand. */
        function toggle(key, isOpen) {
          if (isOpen) { open.delete(key); open.add(`!${key}`); } else { open.delete(`!${key}`); open.add(key); }
        }

        /** A result line. Which translation it came from is only worth saying
         *  when more than one was searched. */
        function line(row, many) {
          const label = row.merge ? `${row.verse}–${row.merge}` : String(row.verse);
          return h('button', {
            class: 'result-line',
            title: shell.workspace.englishRef(row.book, row.chapter, row.verse),
            onclick: (e) => shell.openVerse(row.book, row.chapter, row.verse, { newTab: wantsNewTab(e) }),
          },
            h('span', { class: 'kbd' }, label),
            many ? h('span', { class: 'sr-tr' }, row.identify) : null,
            ' ', row.before, h('mark', {}, row.hit), row.after);
        }

        // With a keyboard the results follow the typing. On a phone nothing
        // moves until the keyboard's Search key is pressed, which also puts
        // the keyboard away: a list that jumps under a thumb at every letter
        // is in the way. Emptying the field clears the results either way.
        const quiet = () => shell.phone?.on === true;
        const go = () => run().catch((err) => shell.notify(err.message, 'error'));
        input.addEventListener('input', () => {
          clearTimeout(timer);
          if (quiet() && input.value.trim()) return;
          timer = setTimeout(go, DEBOUNCE_MS);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || !quiet()) return;
          event.preventDefault();
          clearTimeout(timer);
          go();
          input.blur();
        });

        paintModes();
        paintScopeLabel();
        const offLibrary = ctx.library.on('change', () => paintScopeLabel());
        const offRecords = records.on('change', ({ detail }) => {
          if (writing || (detail.key !== null && detail.key !== KEY)) return;
          reread();
        });
        return () => {
          clearTimeout(timer);
          if (paintTimer) cancelAnimationFrame(paintTimer);
          search.cancel();
          offLibrary();
          offRecords();
          focusInput = null;
          runQuery = null;
        };
      },
    });
  },
};
