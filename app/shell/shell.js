/**
 * The shell: chrome, workspace, modal, keyboard, status bar and the address
 * hash. Features contribute docs, panes and commands; the shell decides how
 * they appear.
 */

import { createChrome } from './chrome.js';
import { createModal } from './modal.js';
import { createFormDialog } from './formdialog.js';
import { lookup } from '../core/lexicon.js';
import { createNavPop } from './navpop.js';
import { createPeek } from './peek.js';
import { createColorPicker } from './colorpicker.js';
import { createConfirm } from './confirm.js';
import { createTranslationInfo } from './trinfo.js';
import { createTree } from './tree.js';
import { createReadingPanel, applyReading } from './readingpanel.js';
import { createVerseBar } from './versebar.js';
import { createWorkspace } from './workspace.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';
import { createLookup, parsePassageQuery, passageOf } from '../core/lookup.js';
import { MODES } from '../core/settings.js';
import { storageStatus } from '../services/store.js';
import { wordCount } from '../core/markdown.js';
import { BUILT_AT, VERSION } from '../version.js';
import { applyAccent, applyTheme, THEME_CYCLE } from './theme.js';

export function createShell(root, ctx) {
  const { store } = ctx;
  let chrome = null;
  let workspace = null;
  let tree = null;
  let verseBar = null;
  let readingPanel = null;
  let navPop = null;
  let trInfo = null;
  let peek = null;
  let colours = null;
  const modal = createModal();
  const confirm = createConfirm();
  const form = createFormDialog();
  const strongsPopover = h('div', { class: 'popover', hidden: true });

  const ready = [];
  /**
   * Whether a feature has taken responsibility for what a brand-new reader
   * sees. Two features both want the first screen — the Library, because
   * nothing can be read until something is installed, and the welcome, because
   * a list of sixty translations does not answer "what is this". Claiming is
   * done while features are being set up, so neither depends on the order the
   * other's first paint happens to finish in.
   */
  let firstRunClaimed = false;

  const shell = {
    /** Run once the shell is up — a feature cannot open a document before then. */
    whenReady(fn) {
      if (chrome) fn();
      else ready.push(fn);
    },
    notify(message, kind = 'info', options = {}) {
      if (chrome) chrome.notify(message, kind, options);
      else console.error(`[${kind}] ${message}`);
    },
    openDoc: (id) => workspace.openDoc(id),
    /** @returns {boolean} true for the one feature that greets a new reader. */
    claimFirstRun() {
      if (firstRunClaimed) return false;
      firstRunClaimed = true;
      return true;
    },
    get firstRunClaimed() { return firstRunClaimed; },
    /**
     * Follow a reference. `{ newTab }` leaves what the reader was on where it
     * was — the options travelled no further than `workspace` until now, which
     * is why nothing in the app could ever open a second tab.
     */
    openChapter: (book, chapter, options) => workspace.openChapter(book, chapter, options),
    openSwitcher,
    openPalette,
    openTranslationPicker,
    /** The one modal, for a feature that needs to offer a list of its own. */
    pick: (options) => modal.open(options),
    /** A short form: several answers at once, or null if the reader backs out. */
    form: (options) => form.open(options),
    /** Run a registered command by id — how one feature reaches another. */
    run(id) {
      const command = ctx.registry.commands().find((c) => c.id === id);
      if (!command) throw new Error(`shell.run: no command "${id}"`);
      return command.run();
    },
    openVerse: (book, chapter, verse, options) => workspace.openVerse(book, chapter, verse, options),
    selectPane: (side, id) => chrome.selectPane(side, id),
    /**
     * Read a reference where it stands. Every link surface routes here, and
     * `reflink.js` decides whether the gesture that asked is one this device
     * actually has.
     */
    openPeek: (anchor, ref) => peek.open(anchor, ref),
    closePeek: () => peek.close(),
    /** Repaint the ribbon's marks; for a feature whose state moves on its own. */
    refreshCommands: () => chrome.refreshCommands(),
    openStrongs,
    /** The info button at the end of a crumb bar: what this translation is. */
    openTranslationInfo: (anchor, meta) => trInfo.open(anchor, meta),
    repairTranslation,
    /** The typography panel, opened from wherever the reader asked for it. */
    openReadingPanel: (anchor) => readingPanel.toggle(anchor),
    /** The colour picker, for any feature that offers a colour. */
    pickColour: (anchor, options) => colours.open(anchor, options),
    /** Ask before something that cannot be undone. Resolves true to go ahead. */
    confirm: (options) => confirm.ask(options),
    /**
     * Read a reference out of typed text — "ps 23:1-6", the translation's own
     * names and numerals — for a feature that wants a passage without building
     * its own parser. Null when the text names nothing.
     */
    readPassage(text) {
      const [first] = passageItems(text);
      return first ? first.passage : null;
    },
    /** The reader's own correction to a translation's text direction. */
    textDirection: (identify) => workspace.directionOf(identify),
    setTextDirection: (identify, dir) => workspace.setDirection(identify, dir),
    /** A breadcrumb was pressed: offer its siblings under it. */
    openCrumb: (anchor, mode, at) => navPop.open(anchor, mode, at, (book, chapter) => workspace.openChapter(book, chapter)),
    /** The primary translation finished loading: names may have changed. */
    refreshNames: () => { tree?.paint(); renderStatus(); },
    openVerseBar: (anchor, passage, options) => verseBar.show(anchor, passage, options),
    get workspace() { return workspace; },
    /** The ribbon's own arrangement, for the settings page. */
    get ribbon() { return chrome.ribbon; },
    start,
  };

  function start() {
    registerShellCommands();
    registerBooksPane();
    chrome = createChrome(root, ctx);
    workspace = createWorkspace(ctx, chrome);
    verseBar = createVerseBar(ctx);
    readingPanel = createReadingPanel(ctx);
    navPop = createNavPop(ctx, {
      bookName: (id) => workspace.bookName(id),
      lang: () => workspace.lang(),
      number: (n) => workspace.number(n),
      english: (id) => workspace.englishBook(id),
      englishRef: (book, chapter) => workspace.englishRef(book, chapter),
    });
    trInfo = createTranslationInfo(ctx);
    peek = createPeek(ctx, {
      bookName: (id) => workspace.bookName(id),
      number: (n) => workspace.number(n),
      lang: () => workspace.lang(),
      direction: () => (workspace.primaryDirection?.() ?? 'ltr'),
      go: (ref, options) => (ref.verse
        ? workspace.openVerse(ref.book, ref.chapter, ref.verse, options)
        : workspace.openChapter(ref.book, ref.chapter, options)),
    });
    colours = createColorPicker();
    document.body.append(modal.element, confirm.element, form.element, verseBar.element, readingPanel.element,
      navPop.element, trInfo.element, peek.element, colours.element, strongsPopover);
    applyReading(ctx.state.get());
    chrome.start();
    wireKeys();

    ctx.state.subscribe(() => { refresh(); });
    ctx.library.on('change', () => { refresh(); measureStorage(); });
    measureStorage();
    ctx.annotations.on('change', () => workspace.render());

    applyHash();
    window.addEventListener('hashchange', applyHash);

    workspace.restore();
    refresh();

    for (const fn of ready.splice(0)) {
      try {
        fn();
      } catch (err) {
        shell.notify(err.message, 'error');
      }
    }
  }

  function refresh() {
    applyReading(ctx.state.get());
    chrome.applyChrome(ctx.state.get());
    chrome.setChapterMode(workspace.activeTab?.kind === 'chapter', workspace.activeTab?.kind ?? null);
    tree?.paint();
    renderStatus();
    measureChapter().catch(() => { counts = null; });
    syncHash();
    workspace.render();
  }

  // --- commands -----------------------------------------------------------

  function registerShellCommands() {
    const { registry } = ctx;
    const command = (id, title, run, extra = {}) => registry.command({ id, title, run, ...extra });

    command('shell.palette', L('cmd.palette'), openPalette, { keys: 'Mod+p', icon: 'cmd' });
    command('shell.switcher', L('cmd.switcher'), () => openSwitcher(), { keys: 'Mod+o', icon: 'book-open' });
    command('passage.next-chapter', L('cmd.next'), () => workspace.step(1), { keys: 'Mod+ArrowRight', icon: 'arrow-right', needsChapter: true });
    command('passage.prev-chapter', L('cmd.prev'), () => workspace.step(-1), { keys: 'Mod+ArrowLeft', icon: 'arrow-left', needsChapter: true });
    command('reading.add-pane', L('cmd.parallel'), () => workspace.addPane(), { icon: 'add-pane', needsChapter: true });
    command('reading.translation', L('cmd.translation'), () => openTranslationPicker(0), { icon: 'swap', needsChapter: true });
    command('reading.copy', L('cmd.copyRef'), copyPassage, { icon: 'copy', needsChapter: true });
    command('reading.layout', L('cmd.layout'), cycleLayout, { icon: 'lay-para', needsChapter: true });
    command('reading.sync', L('cmd.sync'), () => toggleFlag('syncScroll', L('cmd.sync')), { icon: 'sync', state: () => ctx.state.get().syncScroll });
    command('shell.theme', L('cmd.theme'), cycleTheme);
    command('shell.about', L('cmd.about'), showAbout, { icon: 'info', opens: 'about' });
    command('shell.left', L('side.left'), () => chrome.toggleSide('left'), { keys: 'Mod+b', icon: 'panel-l', state: () => ctx.state.get().leftSidebar });
    command('shell.right', L('side.right'), () => chrome.toggleSide('right'), { icon: 'panel-r', state: () => ctx.state.get().rightSidebar });
    command('shell.ribbon', L('cmd.ribbon'), () => toggleFlag('ribbon', L('cmd.ribbon')), { icon: 'rail', state: () => ctx.state.get().ribbon });
    command('shell.statusbar', L('cmd.statusBar'), () => toggleFlag('statusBar', L('cmd.statusBar')), { icon: 'min', state: () => ctx.state.get().statusBar });
    command('reading.panel', L('cmd.reading'), () => readingPanel.toggle(document.querySelector('.statusbar .sb-reading') ?? document.body), { icon: 'type' });
    command('reading.mode', L('cmd.mode'), toggleMode, { keys: 'Mod+e', icon: 'edit', needsChapter: true, state: () => ctx.state.get().mode === 'source' });
    command('reading.strongs', L('cmd.strongs'), toggleStrongs, { icon: 'tag', needsChapter: true, state: () => ctx.state.get().strongs });
    command('tab.detach', L('cmd.detach'), () => { const tab = workspace.activeTab; if (tab) workspace.detach(tab.id); }, { icon: 'restore' });
    command('tab.next', L('cmd.nextTab'), () => stepTab(1), { keys: 'Mod+Shift+ArrowRight', icon: 'tab-next' });
    command('tab.prev', L('cmd.prevTab'), () => stepTab(-1), { keys: 'Mod+Shift+ArrowLeft', icon: 'tab-prev' });
    command('tab.close', L('cmd.closeTab'), () => { const tab = workspace.activeTab; if (tab) workspace.closeTab(tab.id); }, { keys: 'Mod+w', icon: 'x' });
    registerShellVerbs();
  }

  /**
   * The words the palette takes as instructions. The shell owns the ones that
   * are about where you are; a feature owns the ones that are about what it
   * does.
   */
  function registerShellVerbs() {
    const verb = (id, word, title, run, options = {}) => ctx.registry.verb({ id, word, title, run, ...options });
    verb('go', 'go', L('verb.go'), (passage) => goTo(passage), { icon: 'book-open', hint: L('verb.goHint') });
    verb('copy', 'copy', L('verb.copy'), (passage) => copyPassageRef(passage), { icon: 'copy', hint: L('verb.copyHint') });
    verb('parallel', 'parallel', L('verb.parallel'), (name) => openParallel(name), {
      takes: 'text', icon: 'add-pane', hint: L('verb.parallelHint'),
    });
  }

  /** "parallel niv": put a translation beside the one being read, by name. */
  async function openParallel(name) {
    const wanted = String(name).trim().toLowerCase();
    const installed = await ctx.store.list();
    const found = installed.find((t) => t.identify.toLowerCase() === wanted)
      ?? installed.find((t) => `${t.info.shortname ?? ''}`.toLowerCase() === wanted)
      ?? installed.find((t) => t.identify.toLowerCase().startsWith(wanted)
        || `${t.info.name ?? ''}`.toLowerCase().includes(wanted));
    if (!found) { shell.notify(L('msg.noTranslation', { name }), 'error'); return; }
    const open = workspace.panes();
    if (open.includes(found.identify)) { shell.notify(L('msg.alreadyOpen', { name: found.info.shortname ?? found.identify })); return; }
    ctx.state.set({ parallel: [...open.slice(1), found.identify] });
  }

  /** The reference alone, for pasting into something else. */
  async function copyPassageRef(passage) {
    const span = passage.verse
      ? `:${passage.to && passage.to !== passage.verse ? `${passage.verse}-${passage.to}` : passage.verse}`
      : '';
    const label = `${workspace.bookName(passage.book)} ${workspace.number(passage.chapter)}${span}`;
    await navigator.clipboard.writeText(label);
    shell.notify(L('msg.copied', { what: label }));
  }

  function registerBooksPane() {
    ctx.registry.pane({
      id: 'files',
      side: 'left',
      order: 10,
      icon: 'files',
      title: L('pane.files'),
      mount(el) {
        tree = createTree(ctx, { onOpen: (book, chapter) => workspace.openChapter(book, chapter) });
        tree.setBookName((id) => workspace.bookName(id));
        tree.setNames({
          testament: (id) => workspace.testamentName(id),
          lang: () => workspace.lang(),
          number: (n) => workspace.number(n),
          english: (id) => workspace.englishBook(id),
          englishTestament: (id) => workspace.englishTestament(id),
          englishRef: (book, chapter) => workspace.englishRef(book, chapter),
          has: (id) => workspace.hasBook(id),
          digits: () => workspace.digits(),
        });
        el.append(tree.element);
        tree.paint();
      },
    });
  }

  /**
   * Download a translation again over the copy that is here.
   *
   * Two different situations end up here: a file corrected upstream without the
   * catalog's version changing, and a stored copy that is incomplete. The cure
   * is the same, and the install is a single transaction, so a failed attempt
   * leaves what is already stored alone.
   */
  async function repairTranslation(identify) {
    shell.notify(L('msg.refreshing', { name: identify }));
    try {
      const result = await ctx.library.install(identify);
      shell.notify(L('msg.refreshed', { name: identify, version: result.version }));
      workspace.render();
    } catch (err) {
      shell.notify(err.message, 'error');
    }
  }

  async function copyPassage() {
    const { book, chapter, translation } = ctx.state.get();
    const label = `${workspace.bookName(book)} ${workspace.number(chapter)}`;
    await navigator.clipboard.writeText(`${label} (${translation ?? ''})`.trim());
    shell.notify(L('msg.copied', { what: label }));
  }

  function cycleLayout() {
    const LAYOUTS = workspace.layouts;
    const next = LAYOUTS[(LAYOUTS.indexOf(ctx.state.get().layout) + 1) % LAYOUTS.length];
    ctx.state.set({ layout: next });
    shell.notify(L('msg.state', { what: L('cmd.layout'), value: L(`val.${next}`) }));
  }

  function toggleFlag(key, label) {
    const value = !ctx.state.get()[key];
    ctx.state.set({ [key]: value });
    shell.notify(L('msg.state', { what: label, value: L(value ? 'val.on' : 'val.off') }));
  }

  async function showAbout() {
    const native = ctx.platform.capabilities.appInfo ? await ctx.platform.capabilities.appInfo() : null;
    const built = new Date(BUILT_AT).toLocaleDateString();
    shell.notify(`${L('app.name')} ${VERSION} · ${L('lbl.built', { date: built })}`
      + (native ? ` · ${native.runtime} · ${native.platform}` : ` · ${ctx.platform.id}`));
  }

  function toggleMode() {
    const next = MODES[(MODES.indexOf(ctx.state.get().mode) + 1) % MODES.length];
    ctx.state.set({ mode: next });
    shell.notify(L('msg.state', { what: L('cmd.mode'), value: L(`val.${next}`) }));
  }

  /**
   * Strong's numbers show only where a translation carries the markup; none of
   * the published translations do today, so say that rather than toggling a
   * setting with no visible effect.
   */
  function toggleStrongs() {
    const next = !ctx.state.get().strongs;
    ctx.state.set({ strongs: next });
    const present = document.querySelector('.chapter .strongs');
    shell.notify(present
      ? L('msg.state', { what: L('cmd.strongs'), value: L(next ? 'val.on' : 'val.off') })
      : L('msg.noStrongs'));
  }

  /**
   * What a Strong's number means.
   *
   * This printed the code and the sentence "No lexicon is installed" from the
   * day it was written, because there was no lexicon and nowhere to get one.
   * There is now: one file per testament in the catalog repository, fetched
   * when a reader first presses a number and only for the testament that number
   * belongs to. Until then the popover offers the download rather than stating
   * a lack — a dead end with a button on it is a different thing from a dead
   * end.
   */
  function openStrongs(code, anchor) {
    const paint = (...children) => {
      strongsPopover.replaceChildren(h('div', { class: 'pv-code' }, code), ...children);
      place();
    };
    const place = () => {
      strongsPopover.hidden = false;
      const rect = anchor.getBoundingClientRect();
      const width = strongsPopover.offsetWidth;
      strongsPopover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      strongsPopover.style.top = `${rect.bottom + 8}px`;
    };

    const show = () => {
      const found = lookup(ctx.lexicons?.held ?? {}, code);
      if (found.entry) {
        const { entry } = found;
        paint(
          entry.lemma ? h('div', { class: 'pv-lemma' }, entry.lemma) : null,
          entry.translit || entry.pronounce
            ? h('div', { class: 'pv-say' }, [entry.translit, entry.pronounce].filter(Boolean).join(' · '))
            : null,
          entry.part ? h('div', { class: 'pv-part' }, entry.part) : null,
          entry.define ? h('div', { class: 'pv-tr' }, entry.define) : null,
          entry.kjv ? h('div', { class: 'pv-kjv' }, entry.kjv) : null);
        return;
      }
      if (found.why === 'missing' || found.why === 'none') {
        const which = found.testament || 'H';
        paint(
          h('div', { class: 'pv-tr' }, L('lex.notHere', { which: L(`lex.${which}`) })),
          ctx.lexicons?.fetching(which)
            ? h('div', { class: 'pv-say' }, L('lex.fetching'))
            : h('button', {
              class: 'btn primary pv-get',
              onclick: (event) => {
                event.currentTarget.disabled = true;
                event.currentTarget.textContent = L('lex.fetching');
                ctx.lexicons.install(which)
                  .then(() => show())
                  .catch((err) => paint(h('div', { class: 'pv-tr' }, err.message)));
              },
            }, L('lex.get', { which: L(`lex.${which}`) })));
        return;
      }
      paint(h('div', { class: 'pv-tr' }, L(found.why === 'ambiguous' ? 'lex.ambiguous' : 'lex.absent')));
    };

    show();
    // Anywhere but in it. The popover had nothing to press until now, so a
    // close handler that fired on every press was harmless; the moment it grew
    // a button, pressing that button shut the popover instead.
    const close = (event) => {
      if (event && strongsPopover.contains(event.target)) return;
      strongsPopover.hidden = true;
      document.removeEventListener('pointerdown', close);
    };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(ctx.state.get().theme) + 1) % THEME_CYCLE.length];
    ctx.state.set({ theme: next });
    applyTheme(next);
    chrome.refreshThemeIcon();
    shell.notify(L('msg.state', { what: L('cmd.theme'), value: L(`val.${next}`) }));
  }

  // --- modal users --------------------------------------------------------

  function openPalette() {
    modal.open({
      placeholder: L('ph.palette'),
      items: ctx.registry.commands().map((c) => ({ id: c.id, title: c.title, keys: c.keys?.replace('Mod', '⌘/Ctrl'), icon: c.icon ?? 'cmd', run: c.run })),
      // A reference is a command too: "ps 23", "1 jn 2:1-4". It is offered
      // above the commands, since somebody who typed a passage meant a passage.
      // A verb and a reference together — "note ps 23:1-6" — is offered above
      // both, because it is the most specific reading of what was typed.
      suggest: (text) => [
        ...verbItems(text),
        ...passageItems(text).map((item) => ({ ...item, run: () => goTo(item.passage) })),
      ],
      onPick: (item) => item.run(),
    });
  }

  /**
   * What was typed, read as an instruction: a verb, then whatever it acts on.
   *
   * The verb may be abbreviated as long as it is still the only one that
   * starts that way, so "no ps 23" is the note on Psalm 23. A passage verb with
   * nothing after it acts on the passage already on screen, which makes the
   * palette a way of doing something *here* as well as somewhere named.
   */
  function verbItems(text) {
    const trimmed = text.trim();
    // A word on its own is a name, not an instruction: "parallel" is the
    // command called Open parallel pane, and a reader who typed it and pressed
    // enter meant that. The space is what turns the word into a verb — it is
    // the reader saying something follows — so nothing is offered without one.
    if (!/\s/.test(text) || trimmed.length < 2) return [];
    const at = trimmed.search(/\s/);
    const word = (at === -1 ? trimmed : trimmed.slice(0, at)).toLowerCase();
    const rest = at === -1 ? '' : trimmed.slice(at + 1).trim();
    if (!/^[a-z][a-z-]*$/.test(word)) return [];
    const matched = ctx.registry.verbs().filter((v) => v.word.startsWith(word));
    if (!matched.length) return [];

    const items = [];
    for (const verb of matched.slice(0, 4)) {
      if (verb.takes === 'text') {
        if (!rest) { items.push(verbHint(verb)); continue; }
        items.push({
          id: `verb.${verb.id}`, title: `${verb.title}: ${rest}`, sub: verb.hint ?? undefined,
          icon: verb.icon, run: () => verb.run(rest),
        });
        continue;
      }
      const targets = rest ? passageItems(rest).slice(0, 3) : [];
      if (!rest) {
        const here = workspace.activeTab?.kind === 'chapter' ? workspace.activeTab : null;
        if (!here) { items.push(verbHint(verb)); continue; }
        const passage = { book: here.book, chapter: here.chapter, verse: null, to: null };
        items.push({
          id: `verb.${verb.id}.here`,
          title: `${verb.title} — ${workspace.bookName(here.book)} ${workspace.number(here.chapter)}`,
          sub: verb.hint ?? L('lbl.onScreen'), icon: verb.icon, run: () => verb.run(passage),
        });
        continue;
      }
      if (!targets.length) { items.push(verbHint(verb)); continue; }
      for (const target of targets) {
        items.push({
          id: `verb.${verb.id}.${target.id}`,
          title: `${verb.title} — ${target.title}`,
          sub: verb.hint ?? undefined,
          icon: verb.icon,
          run: () => verb.run(target.passage),
        });
      }
    }
    return items;
  }

  /** The verb itself, offered as a reminder of what it wants after it. */
  function verbHint(verb) {
    return {
      id: `verb.${verb.id}.hint`, title: `${verb.word} …`,
      sub: verb.hint ?? verb.title, icon: verb.icon,
      run: () => openPaletteWith(`${verb.word} `),
    };
  }

  /** Reopen the palette with a line already started. */
  function openPaletteWith(query) {
    openPalette();
    modal.setQuery(query);
  }

  function openSwitcher(book) {
    const items = [];
    for (const b of ctx.category.books) {
      const name = bookName(b.id);
      for (let c = 1; c <= b.chapters; c += 1) {
        items.push({ id: `${b.id}.${c}`, title: `${name} ${c}`, sub: b.name === name ? undefined : `${b.name} ${c}`, icon: 'book-open', book: b.id, chapter: c });
      }
    }
    modal.open({
      placeholder: L('ph.switcher'),
      items,
      query: book ? `${bookName(book)} ` : '',
      suggest: passageItems,
      onPick: (item) => (item.passage ? goTo(item.passage) : workspace.openChapter(item.book, item.chapter)),
    });
  }

  /**
   * What somebody typed, read as a passage: "ps 23", "psa 3:2-4", and the same
   * in the translation's own name and numerals. A token that fits several
   * books offers each of them rather than guessing.
   */
  function passageItems(text) {
    const lookup = createLookup({
      category: ctx.category,
      resolver: workspace.resolver(),
      bookName: (id) => workspace.bookName(id),
      digits: workspace.digits(),
    });
    const query = parsePassageQuery(text, lookup);
    if (!query) return [];
    return query.books.slice(0, 5).map((book) => {
      const passage = passageOf(query, book, lookup);
      const span = passage.verse
        ? `:${passage.to ? `${passage.verse}–${passage.to}` : passage.verse}`
        : '';
      const name = workspace.bookName(book);
      const canon = ctx.category.book(book).name;
      return {
        id: `go.${book}.${passage.chapter}`,
        title: `${name} ${workspace.number(passage.chapter)}${span}`,
        sub: name === canon ? L('cmd.goToPassage') : `${canon} ${passage.chapter}${span}`,
        icon: 'book-open',
        passage,
      };
    });
  }

  /** Open a passage, and reveal the verse when one was named. */
  function goTo({ book, chapter, verse }) {
    if (verse) workspace.openVerse(book, chapter, verse);
    else workspace.openChapter(book, chapter);
  }

  async function openTranslationPicker(index) {
    const installed = await ctx.store.list();
    const open = workspace.panes();
    modal.open({
      placeholder: L('ph.translation'),
      // A translation whose name is in its own script has to be findable by
      // what the reader can type: its identify and its language, in Latin.
      items: installed.map((t) => ({
        id: t.identify,
        title: `${t.info.shortname} · ${t.info.name}`,
        sub: [t.identify, t.info.language.text, t.info.year, open.includes(t.identify) ? L('lbl.openNow') : '']
          .filter(Boolean).join(' · '),
        icon: 'book',
      })),
      onPick: (item) => workspace.setPaneTranslation(index, item.id),
    });
  }

  function bookName(id) {
    return workspace.bookName(id);
  }

  // --- keyboard -----------------------------------------------------------

  /**
   * A binding is written as it reads: "Mod+Shift+ArrowRight", where Mod is
   * Control or Command. Digits are the exception — Mod+1 to Mod+9 go to a tab,
   * and registering nine commands for that would fill the palette with rows
   * nobody searches for, so they are handled here and shown on the shortcuts
   * page as one line.
   */
  function wireKeys() {
    window.addEventListener('keydown', (e) => {
      if (modal.isOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      // Typing in a field takes the plain keys, but not the ones held with
      // Control or Command: a writer who wants the palette should not have to
      // leave the note first. The combinations the field itself owns —
      // copy, paste, undo and their neighbours — are left alone.
      if (isTyping(e.target) && (!mod || EDITING_KEYS.has(e.key.toLowerCase()))) return;
      if (mod && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        goToTab(Number(e.key));
        return;
      }
      const combo = `${mod ? 'Mod+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}`
        + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
      const command = ctx.registry.commands().find((c) => c.keys === combo);
      if (command) { e.preventDefault(); command.run(); }
    });
  }

  /** Mod+9 is the last tab, however many there are; the rest count from the left. */
  function goToTab(n) {
    const { tabs } = workspace;
    const tab = n === 9 ? tabs.at(-1) : tabs[n - 1];
    if (tab) workspace.activate(tab.id);
  }

  /** Round the strip, so the last tab leads back to the first. */
  function stepTab(delta) {
    const { tabs, activeTab: current } = workspace;
    if (tabs.length < 2) return;
    const at = tabs.findIndex((t) => t.id === current?.id);
    workspace.activate(tabs[(at + delta + tabs.length) % tabs.length].id);
  }

  /** What a text field does with Control held, and the shell must not take. */
  const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'backspace', 'delete', 'arrowleft', 'arrowright']);

  function isTyping(target) {
    return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  // --- status bar ---------------------------------------------------------

  /**
   * Status bar. The left group is what is being read — translation, passage,
   * how much text is in it; the right group is state the reader can click.
   * Counts come from the chapter actually on screen, so they say something
   * about what is in front of them rather than about the file.
   */
  function renderStatus() {
    const { book, chapter, layout, syncScroll, mode, strongs, readingSize } = ctx.state.get();
    const label = `${workspace.bookName(book)} ${workspace.number(chapter)}`;
    const onChapter = workspace.activeTab?.kind === 'chapter';
    // A control that acts on the chapter is shown but not pressable while a
    // document tab is active, so the bar never claims to describe one.
    const chapterOnly = (button) => {
      button.disabled = !onChapter;
      button.setAttribute('aria-disabled', String(!onChapter));
      return button;
    };

    const left = [
      h('span', { class: 'sb sb-app hide-sm' },
        h('img', { class: 'sb-mark', src: './icons/icon.svg', alt: '', width: 14, height: 14 }),
        h('span', {}, L('app.name'))),
      h('button', { class: 'sb', title: L('cmd.translation'), onclick: () => openTranslationPicker(0) },
        icon('book'), h('span', {}, workspace.primaryName())),
      chapterOnly(h('button', {
        class: 'sb', title: `${workspace.englishRef(book, chapter)} — ${L('cmd.switcher')}`,
        'aria-label': `${L('cmd.switcher')}: ${workspace.englishRef(book, chapter)}`,
        onclick: () => openSwitcher(book),
      }, icon('book-open'), h('span', { lang: workspace.lang() }, label))),
      // Before any chapter has been measured there is nothing to report, and
      // "0 words" would be a claim about the passage rather than about the
      // absence of a measurement.
      h('span', { class: 'sb hide-sm', title: L('lbl.wordsIn', { ref: label }) },
        icon('quote'), h('span', {}, counts ? L('lbl.words', { n: counts.words }) : L('val.unmeasured'))),
      h('span', { class: 'sb hide-sm', title: L('lbl.versesIn', { ref: label }) },
        icon('lay-list'), h('span', {}, counts ? L('lbl.verses', { n: counts.verses }) : L('val.unmeasured'))),
    ];
    const right = [
      h('button', { class: 'sb sb-reading', onclick: (e) => readingPanel.toggle(e.currentTarget) }, icon('type'), `${readingSize}px · ${L(`val.${layout}`)}`),
      chapterOnly(h('button', { class: 'sb', onclick: toggleMode }, icon(mode === 'source' ? 'edit' : 'eye'), L(`val.${mode}`))),
      chapterOnly(h('button', { class: 'sb', onclick: toggleStrongs },
        h('span', { class: `dot${strongs ? '' : ' off'}` }), L('cmd.strongs'))),
      chapterOnly(h('button', { class: 'sb', onclick: () => toggleFlag('syncScroll', L('cmd.sync')) },
        h('span', { class: `dot${syncScroll ? '' : ' off'}` }), L('cmd.sync'))),
      h('button', { class: 'sb', title: storage.title, onclick: () => workspace.openDoc('about') },
        icon('db'), h('span', {}, storage.text)),
    ];
    chrome.setStatus(left, right);
  }

  /** What the counts in the status bar last measured, and the storage readout. */
  let counts = null;
  let storage = { text: '—', title: '' };
  let countToken = 0;

  /**
   * Measure the chapter in view, then repaint the bar with what it found.
   *
   * A document tab in front is not a chapter of nothing: the numbers stay as
   * they were, greyed with the rest of the passage group, rather than dropping
   * to zero and claiming the chapter is empty.
   */
  async function measureChapter() {
    const run = ++countToken;
    const { translation, book, chapter } = ctx.state.get();
    if (workspace.activeTab?.kind !== 'chapter') return;
    const verses = translation ? await store.getChapter(translation, book, chapter) : null;
    if (run !== countToken) return;
    const values = Object.values(verses ?? {});
    const next = { verses: values.length, words: values.reduce((n, v) => n + wordCount(v.text), 0) };
    if (counts && next.words === counts.words && next.verses === counts.verses) return;
    counts = next;
    renderStatus();
  }

  /** How much of the device's storage this app is using, as the browser reports it. */
  async function measureStorage() {
    const { usage, quota, persisted } = await storageStatus();
    const next = usage === null
      ? { text: L('val.unknown'), title: L('lbl.storageUnknown') }
      : {
        text: bytes(usage),
        title: [
          L('lbl.stored', { size: bytes(usage) }),
          quota ? L('lbl.ofQuota', { size: bytes(quota), pct: Math.max(1, Math.round(usage / quota * 100)) }) : null,
          persisted === true ? L('lbl.persisted') : persisted === false ? L('lbl.notPersisted') : null,
        ].filter(Boolean).join(' · '),
      };
    if (next.text === storage.text && next.title === storage.title) return;
    storage = next;
    renderStatus();
  }

  function bytes(n) {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = n / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  // --- address hash -------------------------------------------------------

  function syncHash() {
    const { book, chapter } = ctx.state.get();
    const hash = `#/${book}/${chapter}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function applyHash() {
    const m = /^#\/(\d+)\/(\d+)$/.exec(location.hash);
    if (!m) return;
    const book = Number(m[1]);
    if (!ctx.category.hasBook(book)) return;
    const chapter = Math.min(Math.max(Number(m[2]), 1), ctx.category.book(book).chapters);
    const current = ctx.state.get();
    if (current.book !== book || current.chapter !== chapter) ctx.state.set({ book, chapter });
  }

  return shell;
}
