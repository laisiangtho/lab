/**
 * Library: browse the catalog, make translations available offline, update
 * and remove them, and check the remote catalog for changes.
 */

import { describe, FORMATS, sniff, slug } from '../../core/formats/index.js';
import { twoLetter } from '../../core/langcode.js';
import { pickText } from '../../services/transfer.js';
import { fill, formatBytes, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { requestPersistence, storageStatus } from '../../services/store.js';

/** How the list is arranged. The choice is remembered. */
const VIEWS = Object.freeze(['language', 'all', 'offline', 'mine']);
const KEY = 'library';

export default {
  id: 'library',
  setup(ctx) {
    const { library, records, registry, shell } = ctx;
    const progress = new Map(); // identify -> text
    // The page repaints itself while it is open; an import can be started from
    // the command palette with the page shut, and then there is nothing to
    // repaint and nothing that needs to be.
    let repaint = () => {};
    let query = '';
    const held = records.get(KEY, null);
    let view = VIEWS.includes(held?.view) ? held.view : VIEWS[0];
    const setView = (next) => {
      view = next;
      records.save(KEY, { view: next }).catch(() => { /* a view is not worth a toast */ });
    };

    // How the library lists itself is a setting; the page also offers it, which
    // is where a reader who is already looking at the list will change it.
    registry.setting({
      id: 'library.view',
      section: 'storage',
      order: 10,
      build: (ui) => ui.choice({
        name: L('set.libraryView'),
        hint: L('set.libraryViewHint'),
        options: VIEWS.map((id) => [id, L(`lib.view.${id}`)]),
        value: view,
        onChange: (next) => { setView(next); ui.refresh(); },
      }),
    });

    async function check() {
      try {
        const { changed } = await library.checkForUpdates({ force: true });
        shell.notify(L(changed ? 'lib.catalogChanged' : 'lib.catalogSame'));
      } catch (err) {
        shell.notify(L('lib.catalogFailed', { why: err.message }), 'error');
      }
    }

    /**
     * Ask the browser to keep what is stored when space runs short. It may
     * agree, refuse, or ask the reader; whichever it does is reported.
     */
    async function keep() {
      const granted = await requestPersistence();
      shell.notify(L(granted ? 'lib.kept' : 'lib.notKept'), granted ? 'ok' : 'info');
    }

    async function act(identify, action) {
      // The reader knows the translation by its name, not by the file it is in.
      const name = library.catalog?.get(identify)?.name ?? identify;
      progress.set(identify, L(action === 'remove' ? 'lib.removing' : 'lib.starting'));
      try {
        if (action === 'remove') {
          await library.remove(identify);
          shell.notify(L('lib.removed', { name }));
        } else {
          const result = await library.install(identify);
          // Only what a reader can act on: a catalog that disagrees with the
          // file. How the file differs from the canon belongs with the
          // translation itself, not in a message that disappears.
          const notes = result.versionMismatch
            ? L('lib.versionMismatch', { catalog: result.versionMismatch.catalog, file: result.versionMismatch.file })
            : '';
          shell.notify(notes ? L('lib.installedNoted', { name, notes }) : L('lib.installed', { name }), 'ok');
        }
      } catch (err) {
        shell.notify(`${name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
      }
    }

    /**
     * Bring in a translation the catalog does not carry.
     *
     * The question in the middle — *what is this file?* — is the only part of
     * this worth arguing about, so: it is asked because a file's extension is a
     * poor witness (`.xml` is three formats and `.txt` is any of them), the
     * answer is already filled in from the file's own contents, and getting it
     * wrong costs a press. It is not a gate, it collects nothing, and a reader
     * who accepts every default never types a character.
     *
     * The other three answers exist because most formats cannot carry them. A
     * USFM file knows it is Genesis and has no idea what translation it belongs
     * to; a spreadsheet of verses knows neither.
     */
    async function importFile() {
      const file = await pickText({ accept: '.json,.usfm,.sfm,.usfx,.osis,.xml,.zef,.csv,.tsv,.txt,text/*' });
      if (!file) return;

      const guesses = sniff(file.text, file.name);
      if (!guesses.length) {
        shell.notify(L('imp.unknown', { file: file.name }), 'error');
        return;
      }
      const best = guesses[0].id;
      const found = describe(file.text, best, file.name);

      const answers = await shell.form({
        title: L('imp.title'),
        lede: L('imp.lede', { file: file.name, size: formatBytes(file.size) }),
        confirm: L('imp.do'),
        fields: [
          {
            id: 'format',
            label: L('imp.format'),
            hint: L('imp.formatHint'),
            type: 'choice',
            value: best,
            options: FORMATS.map((format) => ({
              id: format.id,
              label: L(`imp.fmt.${format.id}`),
              sub: confidenceOf(guesses, format.id),
            })),
          },
          { id: 'name', label: L('imp.name'), value: found.name, placeholder: L('imp.namePh') },
          { id: 'identify', label: L('imp.identify'), hint: L('imp.identifyHint'), value: found.identify },
          { id: 'language', label: L('imp.language'), hint: L('imp.languageHint'), value: found.language },
        ],
        // Choosing a different format re-reads the file for what that format
        // says about itself, so the boxes agree with the answer above them.
        onChange: (values, set) => {
          const again = describe(file.text, values.format, file.name);
          set('name', again.name);
          set('identify', again.identify);
          set('language', again.language);
        },
      });
      if (!answers) return;

      const identify = slug(answers.identify || answers.name || file.name);
      progress.set(identify, L('lib.starting'));
      repaint();
      try {
        const result = await library.importTranslation({
          text: file.text,
          format: answers.format,
          identify,
          info: { name: answers.name, language: answers.language, source: file.name },
        });
        const notes = [
          `${L('lbl.books', { n: result.stats.books })}, ${L('lbl.verses', { n: result.stats.verses })}`,
          result.diagnostics.length ? L('lbl.differs', { n: result.diagnostics.length }) : '',
          result.report?.notes ? L('imp.notesDropped', { n: result.report.notes }) : '',
          result.report?.skipped ? L('imp.skipped', { n: result.report.skipped }) : '',
        ].filter(Boolean).join(' · ');
        shell.notify(L('imp.done', { name: answers.name || identify, notes }), 'ok');
      } catch (err) {
        shell.notify(`${file.name}: ${err.message}`, 'error');
      } finally {
        progress.delete(identify);
        repaint();
      }
    }

    /** What a stored translation was imported from, named. */
    const formatName = (id) => (FORMATS.some((f) => f.id === id) ? L(`imp.fmt.${id}`) : L('lib.offline'));

    /** How sure the sniff was about one format, in words. */
    function confidenceOf(guesses, id) {
      const found = guesses.find((g) => g.id === id);
      if (!found) return L('imp.no');
      if (found.confidence >= 0.8) return L('imp.likely');
      return found.confidence >= 0.5 ? L('imp.maybe') : L('imp.possible');
    }

    /**
     * The languages this device asks for, most wanted first, as two-letter
     * codes: what the reader is most likely to want to read.
     */
    const wanted = new Set((typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
      .filter(Boolean).map((tag) => twoLetter(tag)).filter(Boolean));
    /**
     * Is this one of the reader's own languages?
     *
     * Both sides go through the same mapping, which they did not before: the
     * catalog names a language by its 639-3 code (`nob`, `fin`) and a browser
     * asks for 639-1 (`nb`, `fi`), so this compared two codes that can never be
     * equal and nobody's language was ever recognised. A reader in Oslo was
     * shown sixty translations in alphabetical order with the Norwegian ones
     * somewhere in the middle and no mark on them.
     */
    const suggested = (row) => {
      const code = twoLetter(row.entry?.language.name ?? row.entry?.language.text ?? '');
      return Boolean(code) && wanted.has(code);
    };

    // A reader with nothing installed cannot read anything, so the first run
    // opens here rather than on an empty workspace — unless another feature has
    // taken the first screen, in which case this list is one press away from it
    // and does not need to open over it.
    ctx.shell.whenReady(async () => {
      if (ctx.shell.firstRunClaimed) return;
      const installed = await ctx.store.list();
      if (installed.length) return;
      ctx.shell.openDoc('library');
    });

    registry.command({ id: 'library.check', title: L('cmd.checkUpdates'), icon: 'download', run: check });
    registry.command({
      id: 'library.import',
      title: L('imp.cmd'),
      icon: 'enter',
      run: () => importFile().catch((err) => shell.notify(err.message, 'error')),
    });
    registry.command({ id: 'library.open', title: L('doc.library'), icon: 'library', ribbon: true, opens: 'library', run: () => ctx.shell.openDoc('library') });

    registry.doc({
      id: 'library',
      title: L('doc.library'),
      icon: 'library',
      mount(el) {
        let disposed = false;
        const run = () => render().catch((err) => shell.notify(err.message, 'error'));
        repaint = run;

        const filter = h('input', {
          type: 'search', spellcheck: 'false', value: query,
          placeholder: L('lib.filter'), 'aria-label': L('lib.filter'),
          oninput: (e) => { query = e.currentTarget.value; run(); },
        });

        /** Name, abbreviation, language or identify — whatever the reader types. */
        function matches(row) {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          const e = row.entry;
          return [row.identify, e?.name, e?.shortname, e?.language.text, e?.publisher, e?.year]
            .filter(Boolean).join(' ').toLowerCase().includes(q);
        }

        /**
         * The page is built once and only the list is replaced afterwards.
         * Rebuilding the whole document on every keystroke moved the filter
         * field in the document, and moving a focused element takes the focus
         * with it — the caret jumped out of the box on every letter typed.
         */
        const note = h('p', { class: 'muted' });
        const count = h('span', { class: 'muted lib-count' });
        const views = h('div', { class: 'rp-seg lib-views' }, VIEWS.map((id) => h('button', {
          dataset: { view: id }, 'aria-pressed': String(id === view),
          onclick: () => { setView(id); paintViews(); run(); },
        }, L(`lib.view.${id}`))));
        const list = h('div', { class: 'library-body' });

        /** An icon button in the tools row: what it does is its title. */
        const action = (glyph, label, onclick) => h('button', {
          class: 'lib-act', title: label, 'aria-label': label, onclick,
        }, icon(glyph));

        const paintViews = () => {
          for (const button of views.children) button.setAttribute('aria-pressed', String(button.dataset.view === view));
        };

        el.replaceChildren(h('section', { class: 'doc library' },
          h('header', { class: 'doc-head' },
            h('h1', { class: 'inline-title' }, L('doc.library')),
            note,
            h('div', { class: 'lib-tools' },
              h('div', { class: 'field' }, icon('search'), filter),
              views,
              h('span', { class: 'grow' }),
              count,
              // Two icons rather than two sentences. Add and refresh are drawn
              // the same way everywhere, they take a quarter of the room, and
              // the row still reads at a glance in a language this build has
              // never been translated into.
              action('plus', L('imp.cmd'), () => importFile().catch((err) => shell.notify(err.message, 'error'))),
              action('sync', L('cmd.checkUpdates'), check))),
          list));

        async function render() {
          const [rows, storage] = await Promise.all([library.status(), storageStatus()]);
          if (disposed) return;
          const catalog = library.catalog;
          const header = library.origin === 'bundled'
            ? L('lib.bundled')
            : L('lib.catalog', {
              version: catalog.version,
              updated: new Date(catalog.updated).toLocaleDateString(),
              checked: new Date(library.fetchedAt).toLocaleString(),
            });

          const mode = view;
          const shown = rows.filter(matches).filter((row) => {
            if (mode === 'offline') return row.state !== 'available';
            // What the reader imported themselves, which is the one group
            // nothing else in this list can be filtered down to.
            if (mode === 'mine') return row.state === 'local';
            return true;
          });
          const byName = (a, b) => (a.entry?.name ?? a.identify).localeCompare(b.entry?.name ?? b.identify);

          const groups = new Map();
          if (mode === 'language') {
            for (const row of shown) {
              const lang = row.entry?.language.text ?? L('lib.unlistedGroup');
              if (!groups.has(lang)) groups.set(lang, []);
              groups.get(lang).push(row);
            }
          } else {
            groups.set('', [...shown].sort(byName));
          }
          // The reader's own languages come first, whatever the arrangement.
          const ordered = [...groups.entries()].sort(([a, listA], [b, listB]) => {
            const mine = (l) => (l.some(suggested) ? 0 : 1);
            return mine(listA) - mine(listB) || a.localeCompare(b);
          });

          fill(note,
            `${header} `,
            // The bundled seed carries a dozen translations and the catalog
            // carries five times as many, so a reader whose first check never
            // landed is looking at a short list with no idea it is short. The
            // sentence said so; it needed the press that fixes it beside it.
            library.origin === 'bundled'
              ? h('button', { class: 'link-btn', onclick: () => check().then(run) }, L('lib.checkNow'))
              : null,
            ` · ${L('lib.storageUsed', { size: formatBytes(storage.usage) })}`,
            storage.persisted === false
              ? [' · ', L('lib.notPersistent'), ' ',
                h('button', { class: 'link-btn', onclick: () => keep().then(run) }, L('lib.keep'))]
              : null);
          count.textContent = L('lib.count', { n: shown.length });
          // Installing or removing repaints this list; the reader stays where
          // they were looking, with the focus still on the button they pressed.
          keepPlace(list, () => fill(list, (shown.length
            ? ordered.map(([lang, group]) => h('div', { class: 'library-group' },
              lang ? h('h2', {}, lang) : null,
              h('ul', { class: 'library-list' }, group.map((row) => item(row)))))
            : h('p', { class: 'empty-hint' }, mode === 'mine' && !query.trim()
              ? L('lib.noneYours')
              : L('lib.noHits', { query: query.trim() })))));
        }

        function item(row) {
          const e = row.entry;
          const busy = progress.get(row.identify);
          const actions = {
            available: [[L('lib.install'), 'install']],
            installed: [[L('lib.remove'), 'remove']],
            update: [[L('lib.update'), 'install'], [L('lib.remove'), 'remove']],
            unlisted: [[L('lib.remove'), 'remove']],
            local: [[L('lib.remove'), 'remove']],
          }[row.state];
          return h('li', { class: `library-item state-${row.state}`, dataset: { identify: row.identify } },
            h('div', { class: 'library-meta' },
              h('strong', {}, e ? `${e.shortname} · ${e.name}` : row.identify),
              h('span', { class: 'muted' }, e
                ? [e.year, e.publisher].filter(Boolean).join(' · ')
                : L(row.state === 'local' ? 'lib.yours' : 'lib.unlisted')),
              row.state === 'local' ? h('span', { class: 'badge badge-ok' }, formatName(row.held?.source)) : null,
              row.state === 'update' ? h('span', { class: 'badge' }, `v${row.installedVersion} → v${e.version}`) : null,
              row.state === 'installed' ? h('span', { class: 'badge badge-ok' }, L('lib.offline')) : null,
              // What is actually on the device, for a row that has something on it.
              row.held ? h('span', { class: 'muted lib-held' }, held(row.held)) : null,
              row.state === 'available' && suggested(row) ? h('span', { class: 'badge badge-hint' }, L('lib.suggested')) : null),
            h('div', { class: 'library-actions' }, busy
              ? h('span', { class: 'muted' }, busy)
              : actions.map(([label, action]) => h('button', {
                class: action === 'remove' ? 'btn' : 'btn primary',
                dataset: { place: `${action}:${row.identify}` },
                onclick: () => act(row.identify, action),
              }, label))));
        }

        /** The stored copy in one line: how big it is, and whether it holds the whole canon. */
        function held(record) {
          return [
            record.bytes ? formatBytes(record.bytes) : null,
            record.stats ? L('lbl.books', { n: record.stats.books }) : null,
            record.diagnostics?.total ? L('lbl.differs', { n: record.diagnostics.total }) : null,
          ].filter(Boolean).join(' · ');
        }

        const offChange = library.on('change', run);
        const offProgress = library.on('progress', ({ detail }) => {
          const phase = { download: L('lib.downloading'), convert: L('lib.converting'), validate: L('lib.validating'), write: L('lib.saving') }[detail.phase];
          progress.set(detail.identify, detail.received ? `${phase} ${formatBytes(detail.received)}` : `${phase}…`);
          run();
        });
        run();
        return () => { disposed = true; repaint = () => {}; offChange(); offProgress(); };
      },
    });
  },
};
