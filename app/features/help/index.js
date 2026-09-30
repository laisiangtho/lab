/**
 * Help, Shortcuts and About, as three documents.
 *
 * The shortcut table is generated from the command registry, so it cannot
 * describe a key this build does not bind, and About reports what is actually
 * installed and stored rather than what the app was shipped with.
 */

import { requestPersistence, storageStatus } from '../../services/store.js';
import { formatSections } from './formats.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { keyLabel } from '../../shell/keys.js';
import { L, when, currentLocale } from '../../shell/i18n.js';
import { BUILT_AT, VERSION } from '../../version.js';

export { keyLabel };

const kbd = (keys) => keyLabel(keys).map((key) => h('span', { class: 'kbd' }, key));

export default {
  id: 'help',
  setup(ctx) {
    const { annotations, platform, registry, shell, store } = ctx;

    const task = (iconName, title, description, keys, run) => h('button', {
      class: 'task', dataset: { go: '1' }, onclick: run,
    },
      h('span', { class: 'task-t' }, icon(iconName), title),
      h('span', { class: 'd' }, description),
      keys ? h('span', { class: 'k' }, kbd(keys)) : null);

    const keysOf = (id) => registry.commands().find((c) => c.id === id)?.keys ?? '';
    const run = (id) => () => shell.run(id);

    registry.command({ id: 'help.open', title: L('doc.help'), icon: 'help', opens: 'help', run: () => shell.openDoc('help') });
    registry.command({ id: 'help.shortcuts', title: L('doc.shortcuts'), icon: 'cmd', opens: 'shortcuts', run: () => shell.openDoc('shortcuts') });
    registry.command({ id: 'help.about', title: L('doc.about'), icon: 'info', opens: 'about', run: () => shell.openDoc('about') });
    registry.command({ id: 'help.formats', title: L('doc.formats'), icon: 'db', opens: 'formats', run: () => shell.openDoc('formats') });

    // --- Help ---------------------------------------------------------------

    registry.doc({
      id: 'help',
      title: L('doc.help'),
      icon: 'help',
      mount(el) {
        const guidePane = registry.panes().find((pane) => pane.id === 'guide');
        const has = (id) => registry.commands().some((c) => c.id === id);
        const cards = [
          task('book-open', L('cmd.switcher'), L('doc.t.switcher'), keysOf('shell.switcher'), run('shell.switcher')),
          task('cmd', L('cmd.palette'), L('doc.t.palette'), keysOf('shell.palette'), run('shell.palette')),
          task('add-pane', L('cmd.parallel'), L('doc.t.parallel'), '', run('reading.add-pane')),
          has('search.open') ? task('search', L('pane.search'), L('doc.t.search'), keysOf('search.open'), run('search.open')) : null,
          has('composer.open') ? task('note', L('cmd.composer'), L('doc.t.composer'), keysOf('composer.open'), run('composer.open')) : null,
          has('graph.open') ? task('graph', L('doc.graph'), L('doc.t.graph'), '', run('graph.open')) : null,
          has('plan.open') ? task('calendar', L('pane.plan'), L('doc.t.plan'), '', run('plan.open')) : null,
          has('speech.toggle') ? task('audio', L('cmd.read'), L('doc.t.read'), '', run('speech.toggle')) : null,
          // Shown, not toggled: its own command would hide a guide already open.
          guidePane ? task('guide', L('pane.guide'), L('doc.t.guide'), '', () => shell.selectPane(guidePane.side, 'guide')) : null,
        ].filter(Boolean);

        el.append(
          h('div', { class: 'note doc' },
            h('h1', { class: 'inline-title' }, L('doc.help')),
            h('p', { class: 'doc-lede' }, L('doc.help.lede')),
            h('div', { class: 'task-grid' }, cards),
            h('div', { class: 'doc-h' }, L('doc.help.more')),
            h('div', { class: 'task-grid' },
              task('cmd', L('doc.shortcuts'), L('doc.t.shortcuts'), '', () => shell.openDoc('shortcuts')),
              task('info', L('doc.about'), L('doc.t.about'), '', () => shell.openDoc('about')),
              task('settings', L('cmd.settings'), L('doc.t.settings'), '', () => shell.openDoc('settings')),
              task('db', L('doc.formats'), L('doc.t.formats'), '', () => shell.openDoc('formats')),
              has('welcome.open') ? task('spark', L('doc.welcome'), L('doc.t.welcome'), '', () => shell.openDoc('welcome')) : null)));
      },
    });

    // --- Shortcuts ----------------------------------------------------------

    registry.doc({
      id: 'shortcuts',
      title: L('doc.shortcuts'),
      icon: 'cmd',
      mount(el) {
        const bound = registry.commands().filter((c) => c.keys).map((c) => ({ keys: c.keys, what: c.title }));
        const seen = new Set(bound.map((r) => r.keys));
        // Gestures and modal keys are not commands, so they are listed by hand;
        // a line that repeats a bound key is dropped rather than shown twice.
        const extras = [
          { keys: 'Mod+1…9', what: L('cmd.goToTab') },
          { keys: 'Esc', what: L('doc.keys.esc') },
          { keys: 'ArrowUp+ArrowDown', what: L('doc.keys.arrows') },
          { keys: 'Enter', what: L('doc.keys.enter') },
        ].filter((r) => !seen.has(r.keys));
        const rows = [...bound, ...extras];

        const filter = h('input', { spellcheck: 'false', placeholder: L('ph.filter'), 'aria-label': L('ph.filter') });
        const list = h('div', { class: 'key-list' },
          rows.map((row) => h('div', {
            class: 'key-row',
            dataset: { t: `${row.keys} ${row.what}`.toLowerCase() },
          }, h('span', { class: 'k' }, kbd(row.keys)), h('span', { class: 'a' }, row.what))));
        const empty = h('div', { class: 'key-empty', hidden: true }, L('empty.noHits', { query: '' }));

        filter.addEventListener('input', () => {
          const q = filter.value.trim().toLowerCase();
          let shown = 0;
          for (const row of list.children) {
            const on = !q || row.dataset.t.includes(q);
            row.hidden = !on;
            if (on) shown++;
          }
          empty.hidden = shown > 0;
        });

        // The palette also takes instructions, which are not keys and would
        // never be found by pressing things. They are listed here because this
        // is the page a reader opens to find out what they can type.
        const verbs = registry.verbs();
        const verbList = verbs.length
          ? [h('div', { class: 'doc-h' }, L('doc.keys.verbs')),
            h('p', { class: 'doc-lede' }, L('doc.keys.verbsLede')),
            h('div', { class: 'key-list' }, verbs.map((verb) => h('div', { class: 'key-row' },
              h('span', { class: 'k' }, h('span', { class: 'kbd' }, verb.word)),
              h('span', { class: 'a' }, verb.title, verb.hint ? h('em', { class: 'verb-eg' }, verb.hint) : null))))]
          : [];

        el.append(
          h('div', { class: 'note doc' },
            h('h1', { class: 'inline-title' }, L('doc.shortcuts')),
            h('div', { class: 'note-sub' }, L('doc.keys.sub', { n: rows.length })),
            h('p', { class: 'doc-lede' }, L('doc.keys.lede')),
            h('div', { class: 'field doc-filter' }, icon('search'), filter),
            list,
            empty,
            ...verbList));
      },
    });

    // --- Data and formats ---------------------------------------------------

    /**
     * Everything this app reads and writes, with a real example of each file.
     *
     * A reader who wants to correct a verse, add a translation or read their
     * own notes with another program has to know the shapes; an app that keeps
     * them to itself is asking to be trusted rather than checked. The live
     * figures at the top are what *this* install is actually pointed at and
     * holding, so the document describes the app in front of the reader rather
     * than the one that was shipped.
     */
    registry.doc({
      id: 'formats',
      title: L('doc.formats'),
      icon: 'db',
      mount(el) {
        const facts = h('div', { class: 'fm-facts' });

        // English by design (see formats.js), and marked so: the right fonts
        // and hyphenation, and a screen reader that reads it as English.
        const section = ({ heading, body, sample }) => h('section', { class: 'fm-sec', lang: 'en', dir: 'ltr' },
          h('h2', {}, heading),
          ...body.map((text) => h('p', {}, text)),
          sample
            ? h('figure', { class: 'fm-sample' },
              h('figcaption', {}, sample.caption,
                h('button', {
                  class: 'fm-copy', title: L('cmd.copy'), 'aria-label': L('cmd.copy'),
                  onclick: async () => {
                    await navigator.clipboard.writeText(sample.code);
                    shell.notify(L('msg.copied', { what: sample.caption }));
                  },
                }, icon('copy'))),
              h('pre', {}, h('code', {}, sample.code)))
            : null);

        el.append(
          h('div', { class: 'note doc fm' },
            h('h1', { class: 'inline-title' }, L('doc.formats')),
            h('p', { class: 'doc-lede' }, L('doc.formats.lede')),
            facts,
            // Said once, in the reader's language, before the page turns English.
            currentLocale() === 'en' ? null : h('p', { class: 'fm-lang' }, L('doc.formats.inEnglish')),
            ...formatSections({ config: ctx.config }).map(section)));

        async function paint() {
          const installed = await store.list();
          const departures = installed.reduce((n, t) => n + (t.diagnostics?.total ?? 0), 0);
          fill(facts,
            fact(String(installed.length), L('lbl.translationsHeld')),
            fact(String(installed.reduce((n, t) => n + (t.stats?.verses ?? 0), 0) || '—'), L('lbl.versesHeld')),
            fact(String(departures), L('lbl.departures'),
              departures ? L('lbl.departuresHint') : L('lbl.departuresNone')));
        }

        const fact = (value, label, hint = '') => h('div', { class: 'fm-fact', title: hint },
          h('strong', {}, value), h('span', {}, label));

        paint().catch(() => { /* the document stands without its figures */ });
        return store.on?.('change', () => paint().catch(() => {}));
      },
    });

    // --- About --------------------------------------------------------------

    /**
     * About: what this build is and what it is holding.
     *
     * Centred, and no wider than it needs to be. The facts are figures, so they
     * are set as tiles with the number first and its name under it — a reader
     * scanning for how much is stored finds the number, not the word "Storage".
     */
    registry.doc({
      id: 'about',
      title: L('doc.about'),
      icon: 'info',
      mount(el) {
        const facts = h('div', { class: 'about-facts' });
        const actions = h('div', { class: 'about-acts' });
        const card = h('div', { class: 'about' },
          h('div', { class: 'about-mark' }, h('img', { src: './icons/icon.svg', alt: '', width: 64, height: 64 })),
          h('h1', {}, L('app.name')),
          h('div', { class: 'about-ver' }, `v${VERSION} · ${L('lbl.built', { date: when.date(BUILT_AT) })}`),
          h('p', { class: 'about-lede' }, L('doc.about.lede')),
          facts,
          actions,
          h('p', { class: 'about-note' }, L('doc.about.sources')));
        // The document body is already the scrolling area of its leaf; wrapping
        // another one inside it leaves the card measured against its own
        // content, and nothing to centre it in.
        el.classList.add('about-wrap');
        el.append(card);

        const tile = (value, label, hint = '') => h('div', { class: 'about-tile', title: hint },
          h('strong', {}, value), h('span', {}, label));

        async function paint() {
          const [installed, { usage, quota, persisted }, native] = await Promise.all([
            store.list(),
            storageStatus(),
            platform.capabilities.appInfo ? platform.capabilities.appInfo() : Promise.resolve(null),
          ]);
          const size = installed.reduce((n, t) => n + (t.bytes ?? 0), 0);
          facts.replaceChildren(
            tile(String(installed.length), L('lbl.translationsHeld'), installed.map((t) => t.info.name).join(', ')),
            tile(bytes(size), L('lbl.textStored')),
            tile(String(annotations.allNotes().length), L('pane.notes')),
            tile(String(annotations.allMarks().length), L('pane.marks')),
            tile(usage === null ? L('val.unknown') : bytes(usage), L('lbl.storage'),
              quota ? L('lbl.ofQuota', { size: bytes(quota), pct: Math.max(1, Math.round(usage / quota * 100)) }) : ''),
            tile(native ? native.runtime.split(' ')[0] : L('val.web'), L('lbl.runtime'),
              native ? `${native.runtime} · ${native.platform}` : platform.id));

          // Storage that may be reclaimed is worth an offer, not a label: the
          // button asks the browser to keep it, and says what it answered.
          const update = registry.commands().find((c) => c.id === 'app.checkUpdate');
          fill(actions,
            persisted === false
              ? h('button', {
                class: 'btn primary',
                title: L('lbl.notPersisted'),
                onclick: async () => {
                  const granted = await requestPersistence();
                  shell.notify(L(granted ? 'lib.kept' : 'lib.notKept'), granted ? 'ok' : 'info');
                  paint().catch(() => {});
                },
              }, icon('db'), L('lib.keep'))
              : null,
            update ? h('button', { class: 'btn', onclick: () => update.run() }, icon('download'), update.title) : null,
            h('button', { class: 'btn', onclick: () => shell.openDoc('help') }, icon('help'), L('doc.help')));
        }

        paint().catch((err) => shell.notify(err.message, 'error'));
        const off = annotations.on('change', () => paint().catch(() => {}));
        return off;
      },
    });
  },
};

function bytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
