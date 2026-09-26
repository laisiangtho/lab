/**
 * Library: browse the catalog, make translations available offline, update
 * and remove them, and check the remote catalog for changes.
 */

import { fill, formatBytes, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { requestPersistence, storageStatus } from '../../services/store.js';

/** How the list is arranged. The choice is remembered. */
const VIEWS = Object.freeze(['language', 'all', 'offline']);
const KEY = 'library';

export default {
  id: 'library',
  setup(ctx) {
    const { library, records, registry, shell } = ctx;
    const progress = new Map(); // identify -> text
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
     * The languages this device asks for, most wanted first, as two-letter
     * codes: what the reader is most likely to want to read.
     */
    const wanted = (typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language])
      .filter(Boolean).map((tag) => String(tag).toLowerCase().split('-')[0]);
    const suggested = (row) => {
      const code = String(row.entry?.language.name ?? '').toLowerCase().split('-')[0];
      return Boolean(code) && wanted.includes(code);
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
    registry.command({ id: 'library.open', title: L('doc.library'), icon: 'library', ribbon: true, opens: 'library', run: () => ctx.shell.openDoc('library') });

    registry.doc({
      id: 'library',
      title: L('doc.library'),
      icon: 'library',
      mount(el) {
        let disposed = false;
        const run = () => render().catch((err) => shell.notify(err.message, 'error'));

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
              h('button', { class: 'btn', onclick: check }, icon('undo'), L('cmd.checkUpdates')))),
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
          const shown = rows.filter(matches).filter((row) => mode !== 'offline' || row.state !== 'available');
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
            `${header} · ${L('lib.storageUsed', { size: formatBytes(storage.usage) })}`,
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
            : h('p', { class: 'empty-hint' }, L('lib.noHits', { query: query.trim() })))));
        }

        function item(row) {
          const e = row.entry;
          const busy = progress.get(row.identify);
          const actions = {
            available: [[L('lib.install'), 'install']],
            installed: [[L('lib.remove'), 'remove']],
            update: [[L('lib.update'), 'install'], [L('lib.remove'), 'remove']],
            unlisted: [[L('lib.remove'), 'remove']],
          }[row.state];
          return h('li', { class: `library-item state-${row.state}`, dataset: { identify: row.identify } },
            h('div', { class: 'library-meta' },
              h('strong', {}, e ? `${e.shortname} · ${e.name}` : row.identify),
              h('span', { class: 'muted' }, e ? [e.year, e.publisher].filter(Boolean).join(' · ') : L('lib.unlisted')),
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
          const phase = { download: L('lib.downloading'), validate: L('lib.validating'), write: L('lib.saving') }[detail.phase];
          progress.set(detail.identify, detail.received ? `${phase} ${formatBytes(detail.received)}` : `${phase}…`);
          run();
        });
        run();
        return () => { disposed = true; offChange(); offProgress(); };
      },
    });
  },
};
