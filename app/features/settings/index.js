/**
 * Settings: what is kept between sessions, and moving it between installs.
 *
 * Export writes a small JSON file: reading position, parallel selection, and
 * the list of offline translations with their versions. Translation data is not
 * included (megabytes each) — after import, the missing ones can be downloaded
 * again in one step.
 */

import { buildExport, defaultSettings, parseExport, READING, READING_FONTS } from '../../core/settings.js';
import { numberRow } from '../../shell/numberrow.js';
import { createRows } from '../../shell/settingrows.js';
import { requestPersistence, resetStore, storageStatus } from '../../services/store.js';
import { applyAccent, applyTheme, THEME_CYCLE } from '../../shell/theme.js';
import { icon } from '../../shell/icons.js';
import { L, LOCALES, currentLocale, when } from '../../shell/i18n.js';

/** A short palette; the colour input covers everything else. */
const ACCENTS = Object.freeze(['#7c3aed', '#2563eb', '#0ea5e9', '#14b8a6', '#e9973f', '#e11d48']);
import { BUILT_AT, VERSION } from '../../version.js';
import { formatBytes, h, keepPlace } from '../../shell/dom.js';
import { downloadJson, pickJson } from '../../services/transfer.js';

export default {
  id: 'settings',
  setup(ctx) {
    const { annotations, category, library, records, registry, settings, shell, state, store } = ctx;
    /** Translations named by the last import that are not installed here. */
    let missing = [];
    let importedFrom = null;
    let busy = null;
    const listeners = new Set();
    const refresh = () => { for (const fn of listeners) fn(); };

    /** The accent is applied at once and remembered; null restores the theme's own. */
    function setAccent(colour) {
      state.set({ accent: colour });
      applyAccent(colour);
      refresh();
    }

    async function exportSettings() {
      await settings.save();
      const data = buildExport({
        settings: settings.get(),
        translations: await store.list(),
        catalog: library.catalog,
        annotations: annotations.toJSON(),
        records: records.toJSON(),
        appVersion: VERSION,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`lai-siangtho-settings-${stamp}.json`, data);
      shell.notify(L('msg.exported', {
        notes: L('lbl.notesCount', { n: data.data.notes.length }),
        marks: L('lbl.marks', { n: data.data.marks.length }),
        n: data.library.translations.length,
      }));
    }

    async function importSettings() {
      const file = await pickJson();
      if (!file) return;
      const parsed = parseExport(file.data, { source: file.name, category });
      settings.set(parsed.settings);
      await settings.save();
      state.set(parsed.settings);
      const merged = await annotations.merge(parsed.annotations);
      await records.merge(parsed.records);
      const installed = new Set((await store.list()).map((t) => t.identify));
      missing = parsed.translations.filter((t) => !installed.has(t.identify));
      importedFrom = { name: file.name, exportedAt: parsed.exportedAt, count: parsed.translations.length, merged };
      shell.notify(L(missing.length ? 'msg.importedMissing' : 'msg.imported', {
        file: file.name,
        notes: L('lbl.notesCount', { n: merged.notes }),
        marks: L('lbl.marks', { n: merged.marks }),
        n: missing.length,
      }));
      refresh();
    }

    async function installMissing() {
      const queue = [...missing];
      for (const [i, t] of queue.entries()) {
        busy = L('set.installing', { name: t.identify, i: i + 1, n: queue.length });
        refresh();
        try {
          await library.install(t.identify);
          missing = missing.filter((m) => m.identify !== t.identify);
        } catch (err) {
          shell.notify(`${t.identify}: ${err.message}`, 'error');
        }
      }
      busy = null;
      refresh();
      shell.notify(missing.length
        ? L('msg.installedSome', { n: missing.length })
        : L('msg.installedAll'), missing.length ? 'error' : 'ok');
    }

    const guard = (fn) => () => fn().catch((err) => shell.notify(err.message, 'error'));
    registry.command({ id: 'settings.export', title: L('cmd.exportSettings'), icon: 'download', run: guard(exportSettings) });
    registry.command({ id: 'settings.import', title: L('cmd.importSettings'), icon: 'enter', run: guard(importSettings) });

    registry.command({ id: 'settings.open', title: L('doc.settings'), icon: 'settings', ribbon: true, opens: 'settings', run: () => ctx.shell.openDoc('settings') });

    registry.doc({
      id: 'settings',
      title: L('doc.settings'),
      icon: 'settings',
      mount(el) {
        const ui = createRows({ refresh });

        /**
         * A page that reads settings on every paint cannot repaint while a
         * control on it is being held — the control would be replaced under the
         * pointer, which is what made picking a colour flash. So a control that
         * holds still says so, and the page catches up when it lets go.
         */
        let holding = false;
        const hold = (on) => { holding = on; if (!on) refresh(); };

        /** A switch over one settings key. */
        const flag = (key, name, hint) => ui.toggle({
          name, hint, value: settings.get()[key], onChange: (on) => state.set({ [key]: on }),
        });

        const size = (labelKey, key, spec, unit, decimals) => {
          const control = numberRow({
            label: L(labelKey), spec, unit, decimals,
            value: () => settings.get()[key],
            onChange: (value) => { state.set({ [key]: value }); refresh(); },
          });
          control.update(settings.get()[key]);
          return control;
        };

        /**
         * The page is a column of sections with a list of them beside it, so
         * everything the reader can change is in one place and reachable in one
         * press. What is here is the whole of it: the panel over the status bar
         * is a shortcut to the typography, not a second set of settings.
         *
         * Most sections end with rows the features themselves contributed
         * (`registry.setting`), which is how a setting that belongs to Search or
         * to the Books pane is still found here.
         */
        const SECTIONS = [
          ['appearance', 'set.appearance', 'eye'],
          ['reading', 'set.reading', 'book-open'],
          ['typography', 'set.typography', 'type'],
          ['study', 'set.study', 'files'],
          ['keys', 'set.keys', 'cmd'],
          ['storage', 'set.storage', 'db'],
          ['material', 'set.material', 'download'],
        ];

        /**
         * The accent row: a palette of the colours most people want, the whole
         * spectrum behind the last swatch, and a way back to the default.
         *
         * It is built with the elements to hand, because the picker changes the
         * colour while the reader drags and must not rebuild the page to do it.
         */
        /**
         * The interface language. Every label is read once, when the shell and
         * the features are built, so a new language takes effect by starting
         * the interface again — after the choice is safely written, or the
         * restart would come back in the old one. Each language is named in
         * itself; one not yet checked by a native speaker says so.
         */
        function languageRow(current) {
          const shown = LOCALES[currentLocale()];
          const hint = shown.review ? `${L('set.languageHint')} ${L('set.languageReview')}` : L('set.languageHint');
          return ui.choice({
            name: L('set.language'), hint,
            options: [['device', L('set.languageDevice')], ...Object.entries(LOCALES).map(([id, { name }]) => [id, name, null, id])],
            value: current.locale ?? 'device',
            onChange: async (value) => {
              state.set({ locale: value === 'device' ? null : value });
              await settings.save();
              window.location.reload();
            },
          });
        }

        function accentRow(current) {
          const custom = Boolean(current.accent) && !ACCENTS.includes(current.accent);
          const swatches = ACCENTS.map((colour) => h('button', {
            class: `accent-swatch${current.accent === colour ? ' is-on' : ''}`,
            title: colour, 'aria-label': colour, 'aria-pressed': String(current.accent === colour),
            style: { background: colour },
            onclick: () => setAccent(colour),
          }));
          const pick = h('button', {
            class: `accent-swatch accent-pick${custom ? ' is-on' : ''}`,
            title: L('set.accentCustom'), 'aria-label': L('set.accentCustom'), 'aria-expanded': 'false',
            style: custom ? { background: current.accent } : {},
          });
          const reset = h('button', {
            class: 'set-reset', title: L('set.accentDefault'), 'aria-label': L('set.accentDefault'),
            disabled: !current.accent, onclick: () => setAccent(null),
          }, icon('undo'));

          /** Show a colour as the chosen one without going back to settings. */
          const show = (colour) => {
            for (const swatch of swatches) {
              const on = swatch.title === colour;
              swatch.classList.toggle('is-on', on);
              swatch.setAttribute('aria-pressed', String(on));
            }
            const own = Boolean(colour) && !ACCENTS.includes(colour);
            pick.classList.toggle('is-on', own);
            pick.style.background = own ? colour : '';
            reset.disabled = !colour;
          };

          pick.onclick = () => {
            hold(true);
            shell.pickColour(pick, {
              value: current.accent ?? ACCENTS[0],
              onChange: (colour) => { applyAccent(colour); show(colour); },
              onCommit: (colour) => { state.set({ accent: colour }); applyAccent(colour); show(colour); },
              onClose: () => hold(false),
            });
          };

          return ui.row({ name: L('set.accent'), hint: L('set.accentHint') },
            h('div', { class: 'accent-row' }, ...swatches, pick, reset));
        }

        /**
         * Which way each translation runs. The file says, and usually says
         * correctly; this is where a reader corrects one that does not, without
         * having to find the translation first. Folded away because a reader
         * with sixty translations installed does not want sixty rows open.
         */
        function directionRows(installed) {
          if (!installed.length) return null;
          const rows = installed.map((meta) => {
            const filed = meta.info.language.textdirection?.toUpperCase() ?? 'LTR';
            const current = shell.textDirection(meta.identify) ?? null;
            return ui.choice({
              name: meta.info.shortname ?? meta.identify,
              hint: `${meta.info.language.text} · ${L('val.asFiled', { dir: filed })}`,
              options: [[null, L('val.filed')], ['ltr', 'LTR'], ['rtl', 'RTL']],
              value: current,
              onChange: (value) => { shell.setTextDirection(meta.identify, value); refresh(); },
            });
          });
          const overridden = installed.filter((m) => shell.textDirection(m.identify)).length;
          return h('details', { class: 'set-fold' },
            h('summary', {},
              h('span', { class: 'set-name' }, L('set.directionAll')),
              h('span', { class: 'set-hint' }, overridden
                ? L('set.directionSet', { n: overridden })
                : L('set.directionHint'))),
            h('div', { class: 'set-group' }, ...rows));
        }

        /** Everything back to how the app arrived, without touching the library. */
        async function resetAll() {
          const sure = await shell.confirm({
            title: L('ask.resetAll'), body: L('ask.resetAllBody'),
            confirm: L('set.resetAllDo'), danger: true,
          });
          if (!sure) return;
          const keep = { translation: settings.get().translation, book: settings.get().book, chapter: settings.get().chapter };
          state.set({ ...defaultSettings, ...keep });
          applyTheme(defaultSettings.theme);
          applyAccent(null);
          await settings.save();
          shell.notify(L('msg.resetAll'), 'ok');
          refresh();
        }

        /** Everything gone: translations, notes, marks, records, settings. */
        async function eraseAll() {
          const sure = await shell.confirm({
            title: L('ask.erase'), body: L('ask.eraseBody'),
            confirm: L('set.eraseDo'), danger: true,
          });
          if (!sure) return;
          await resetStore();
          window.location.reload();
        }

        // The two that cannot be undone are registered rather than written into
        // the section, so they stay at the very bottom of it however many rows
        // the features add above them.
        if (!registry.settingRows('storage').some((r) => r.id === 'settings.danger')) {
          registry.setting({
            id: 'settings.danger',
            section: 'storage',
            order: 900,
            build: (rows) => [
              rows.action({
                name: L('set.resetAll'), hint: L('set.resetAllHint'),
                label: L('set.resetAllDo'), glyph: 'undo', kind: 'danger', onClick: guard(resetAll),
              }),
              rows.action({
                name: L('set.erase'), hint: L('set.eraseHint'),
                label: L('set.eraseDo'), glyph: 'trash', kind: 'danger', onClick: guard(eraseAll),
              }),
            ],
          });
        }

        async function render() {
          const current = settings.get();
          const installed = await store.list();
          const held = installed.reduce((n, t) => n + (t.bytes ?? 0), 0);
          const storage = await storageStatus();
          const bookName = category.book(current.book).name;

          const nav = h('nav', { class: 'set-nav' }, SECTIONS.map(([id, key, glyph]) => h('a', {
            class: 'set-nav-item', href: `#set-${id}`,
            onclick: (e) => {
              e.preventDefault();
              el.querySelector(`#set-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            },
          }, icon(glyph), h('span', {}, L(key)))));

          /** The rows this section's features contributed, in their own order. */
          const contributed = (id) => registry.settingRows(id)
            .map((entry) => {
              try {
                return entry.build(ui);
              } catch (err) {
                // One feature's bad row must not cost the reader the page.
                return h('p', { class: 'muted' }, `${entry.id}: ${err.message}`);
              }
            })
            .flat()
            .filter(Boolean);

          const section = (id, key, ...children) => {
            const extra = contributed(id);
            const body = [...children.filter(Boolean)];
            if (extra.length) body.push(h('div', { class: 'set-group' }, ...extra));
            if (!body.length) body.push(h('p', { class: 'muted' }, L('set.nothing')));
            return h('section', { class: 'set-section', id: `set-${id}` },
              h('h2', { class: 'settings-h' }, L(key)), ...body);
          };

          keepPlace(el, () => el.replaceChildren(h('section', { class: 'doc settings' },
            h('header', { class: 'doc-head' },
              h('h1', { class: 'inline-title' }, L('doc.settings')),
              h('p', { class: 'muted' }, L('set.lede'))),

            h('div', { class: 'set-layout' },
              nav,
              h('div', { class: 'set-main' },

                section('appearance', 'set.appearance',
                  h('div', { class: 'set-group' },
                    languageRow(current),
                    ui.choice({
                      name: L('cmd.theme'), hint: L('set.themeHint'),
                      options: THEME_CYCLE.map((id) => [id, L(`val.${id}`)]), value: current.theme,
                      onChange: (value) => { state.set({ theme: value }); applyTheme(value); refresh(); },
                    }),
                    accentRow(current),
                    flag('ribbon', L('cmd.ribbon'), L('set.ribbonHint')),
                    flag('statusBar', L('cmd.statusBar'), L('set.statusHint')),
                    flag('motion', L('set.motion'), L('set.motionHint')),
                    ui.action({
                      name: L('set.ribbonItems'),
                      hint: L('set.ribbonItemsHint', { n: shell.ribbon.items().length }),
                      value: shell.ribbon.isCustom() ? L('val.yours') : L('val.default'),
                      label: L('cmd.ribbonAdd'), glyph: 'plus',
                      onClick: (e) => shell.ribbon.add(e.currentTarget),
                    }),
                    shell.ribbon.isCustom()
                      ? ui.action({
                        name: L('cmd.ribbonReset'), hint: L('set.ribbonResetHint'),
                        label: L('cmd.reset'), glyph: 'undo',
                        onClick: () => { shell.ribbon.set(shell.ribbon.defaults()); refresh(); },
                      })
                      : null)),

                section('reading', 'set.reading',
                  h('div', { class: 'set-group' },
                    ui.choice({
                      name: L('cmd.layout'), hint: L('set.layoutHint'),
                      options: shell.workspace.layouts.map((id) => [id, L(`val.${id}`)]), value: current.layout,
                      onChange: (value) => { state.set({ layout: value }); refresh(); },
                    }),
                    ui.choice({
                      name: L('set.font'), hint: L('set.fontHint'),
                      options: READING_FONTS.map((id) => [id, L(`val.${id}`)]), value: current.readingFont,
                      onChange: (value) => { state.set({ readingFont: value }); refresh(); },
                    }),
                    flag('syncScroll', L('cmd.sync'), L('set.syncHint')),
                    flag('alignRows', L('set.align'), L('set.alignHint')),
                    flag('headings', L('cmd.headings'), L('set.headingsHint')),
                    flag('xrefs', L('cmd.xrefs'), L('set.xrefsHint')),
                    flag('strongs', L('cmd.strongs'), L('set.strongsHint')),
                    flag('restoreTabs', L('set.restore'), L('set.restoreHint'))),
                  directionRows(installed)),

                section('typography', 'set.typography',
                  h('div', { class: 'set-group set-sliders' },
                    size('lbl.textSize', 'readingSize', READING.size, 'px', 0).element,
                    size('lbl.lineHeight', 'readingLeading', READING.leading, '', 2).element,
                    size('lbl.lineLength', 'readingMeasure', READING.measure, 'ch', 0).element,
                    size('lbl.uiSize', 'uiSize', READING.ui, 'px', 0).element),
                  h('p', { class: 'muted set-after' }, L('set.typographyNote'),
                    ' ',
                    h('button', {
                      class: 'link-btn',
                      onclick: () => {
                        state.set({
                          readingSize: READING.size.default,
                          readingLeading: READING.leading.default,
                          readingMeasure: READING.measure.default,
                          uiSize: READING.ui.default,
                        });
                        refresh();
                      },
                    }, L('cmd.reset')))),

                section('study', 'set.study'),

                section('keys', 'set.keys',
                  h('div', { class: 'set-group' },
                    ui.action({
                      name: L('doc.shortcuts'), hint: L('set.keysHint'),
                      label: L('doc.shortcuts'), glyph: 'cmd', onClick: () => shell.openDoc('shortcuts'),
                    }))),

                section('storage', 'set.storage',
                  h('div', { class: 'set-group' },
                    ui.action({
                      name: L('set.installed'),
                      hint: installed.length ? installed.map((t) => t.info.shortname).join(' · ') : L('val.none'),
                      value: installed.length ? formatBytes(held) : '—',
                      label: L('doc.library'), glyph: 'library', onClick: () => shell.openDoc('library'),
                    }),
                    storage.persisted === false
                      ? ui.action({
                        name: L('lbl.storage'), hint: storageHint(storage),
                        label: L('lib.keep'), glyph: 'db', kind: 'primary',
                        onClick: async () => {
                          const granted = await requestPersistence();
                          shell.notify(L(granted ? 'lib.kept' : 'lib.notKept'), granted ? 'ok' : 'info');
                          refresh();
                        },
                      })
                      : ui.readout({
                        name: L('lbl.storage'), hint: storageHint(storage),
                        value: storage.persisted === true ? L('lbl.persisted') : L('val.unknown'),
                      }),
                    ui.readout({
                      name: L('set.lastRead'),
                      hint: `${current.translation ?? '–'} · ${bookName} ${current.chapter}`
                        + (current.parallel.length ? ` · ${L('set.parallel')}: ${current.parallel.join(', ')}` : ''),
                      value: '',
                    })),
                  h('p', { class: 'muted set-after' }, L('set.storageNote'))),

                section('material', 'set.material',
                  h('div', { class: 'set-group' },
                    ui.action({
                      name: L('pane.notes'), hint: L('set.notesHint'),
                      value: String(annotations.allNotes().length),
                      label: L('cmd.open'), glyph: 'files', onClick: () => shell.openDoc('notes-all'),
                    }),
                    ui.readout({
                      name: L('pane.marks'), hint: L('set.marksHint'),
                      value: String(annotations.allMarks().length),
                    }),
                    ui.row({ name: L('set.transfer'), hint: L('set.exportNote') },
                      h('button', { class: 'btn primary', onclick: guard(exportSettings) }, icon('download'), L('set.export')),
                      h('button', { class: 'btn', onclick: guard(importSettings) }, icon('enter'), L('set.import')))),

                  importedFrom ? h('div', { class: 'settings-import' },
                    h('h3', {}, L('set.lastImport')),
                    h('p', { class: 'muted' }, L('set.importSummary', {
                      name: importedFrom.name, notes: importedFrom.merged.notes,
                      marks: importedFrom.merged.marks, count: importedFrom.count,
                    }) + (importedFrom.exportedAt ? ` · ${L('set.exportedAt', { when: when.dateTime(importedFrom.exportedAt) })}` : '')),
                    missing.length
                      ? [h('ul', {}, missing.map((t) => h('li', {}, `${t.identify}${t.version ? ` (v${t.version})` : ''}`))),
                        busy ? h('span', { class: 'muted' }, busy)
                          : h('button', { class: 'btn primary', onclick: guard(installMissing) }, L('set.installMissing', { n: missing.length }))]
                      : h('p', { class: 'muted' }, L('set.allInstalled'))) : null),

                h('p', { class: 'set-foot muted' },
                  `${L('app.name')} v${VERSION} · ${L('lbl.built', { date: when.date(BUILT_AT) })}`,
                  ' · ',
                  h('button', { class: 'link-btn', onclick: () => shell.openDoc('about') }, L('doc.about'))))))));
        }

        /** What the browser has room for, in one line. */
        function storageHint(storage) {
          if (storage.usage === null) return L('lbl.storageUnknown');
          const stored = L('lbl.stored', { size: formatBytes(storage.usage) });
          if (!storage.quota) return stored;
          return `${stored} · ${L('lbl.ofQuota', {
            size: formatBytes(storage.quota),
            pct: Math.max(1, Math.round(storage.usage / storage.quota * 100)),
          })}`;
        }

        const run = () => { if (holding) return; render().catch((err) => shell.notify(err.message, 'error')); };
        listeners.add(run);
        const offChange = library.on('change', run);
        const offAnnotations = annotations.on('change', run);
        const unsubscribe = state.subscribe(run);
        run();
        return () => { listeners.delete(run); offChange(); offAnnotations(); unsubscribe(); };
      },
    });
  },
};
