/**
 * The shell: chrome, workspace, modal, keyboard, status bar and the address
 * hash. Features contribute docs, panes and commands; the shell decides how
 * they appear.
 */

import { createChrome } from './chrome.js';
import { createModal } from './modal.js';
import { openMenu } from './menu.js';
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
import { createPhone } from './phone.js';
import { createWorkspace } from './workspace.js';
import { fill, formatBytes, h } from './dom.js';
import { icon } from './icons.js';
import { L, when } from './i18n.js';
import { createLookup, parsePassageQuery, passageOf } from '../core/lookup.js';
import { MODES, STRONGS_MODES } from '../core/settings.js';

/** A mark for each way of showing words with a Strong's number. */
const STRONGS_ICON = Object.freeze({ plain: 'lay-flow', quiet: 'eye', marked: 'marker', numbers: 'tag' });
import { storageStatus } from '../services/store.js';
import { wordCount } from '../core/markdown.js';
import { BUILT_AT, VERSION } from '../version.js';
import { applyAccent, applyTheme, THEME_CYCLE } from './theme.js';

export function createShell(root, ctx) {
  const { store } = ctx;
  let chrome = null;
  /** Set once the saved tabs are back: before then a verse link waits for them. */
  let tabsRestored = false;
  let workspace = null;
  let tree = null;
  let verseBar = null;
  let readingPanel = null;
  let phone = null;
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

  /** Set by the word-study feature: ({ code, identify, book, chapter, verse }) => void. */
  let studyWord = null;
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
    /**
     * A handler whose failure is said: what a button or a command runs,
     * wrapped so that a throw or a rejection becomes a message instead of
     * nothing happening.
     */
    guard: (fn) => (...args) => Promise.resolve().then(() => fn(...args))
      .catch((err) => shell.notify(err.message, 'error')),
    openDoc: (id) => workspace.openDoc(id),
    /** A sidebar pane, shown in a workspace tab of its own. */
    openPaneTab: (id) => workspace.openPaneTab(id),
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
    /** Read a translation: it becomes the one in the first pane, and the reading comes forward. */
    /** The status bar's items, for Settings. */
    statusBar: {
      items: () => statusItems(),
      add: () => openStatusAdd(),
      reset: () => setStatusItems(statusDefaults()),
      isCustom: () => ctx.settings.get().statusItems !== null,
    },
    readTranslation: (identify) => { workspace.setPaneTranslation(0, identify); workspace.openChapter(ctx.state.get().book, ctx.state.get().chapter); },
    openSwitcher,
    openPalette,
    /** The palette with something already typed in it: a verb to finish, say. */
    openPaletteWith: (query) => openPaletteWith(query),
    /** The palette's suggestions, asked again while it is open. */
    refreshPalette: () => modal.refresh(),
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
    /**
     * Where a pressed word's "Word study" goes, offered by the feature that
     * does the studying; without one the popover has no such button.
     */
    offerWordStudy(fn) { studyWord = fn; },
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
    /** A shareable address for a passage (see `passageLink`). */
    passageLink: (passage) => passageLink(passage),
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
    openVerseBar: (anchor, passage, options) => phone.verseBar.show(anchor, passage, options),
    /** The phone shell (shell/phone.js): whether it is in front, and its sheets. */
    get phone() { return phone; },
    get workspace() { return workspace; },
    /** The ribbon's own arrangement, for the settings page. */
    get ribbon() { return chrome.ribbon; },
    start,
  };

  function start() {
    registerShellCommands();
    registerBooksPane();
    // Last, so every pane a feature registered — and the one above — has a
    // command of its own.
    registerPaneCommands();
    chrome = createChrome(root, ctx);
    // The bar's empty space has the menu too: the way back for an item taken off.
    const bar = chrome.element.querySelector('.statusbar');
    bar?.addEventListener('contextmenu', (event) => { event.preventDefault(); openStatusMenu(bar); });
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
    phone = createPhone(ctx, { chrome, workspace, readingPanel, verseBar });
    document.body.append(modal.element, confirm.element, form.element, verseBar.element, readingPanel.element,
      navPop.element, trInfo.element, peek.element, colours.element, strongsPopover);
    applyReading(ctx.state.get());
    chrome.start();
    wireKeys();

    ctx.state.subscribe(() => { refresh(); });
    ctx.library.on('change', () => { refresh(); measureStorage(); });
    measureStorage();
    ctx.annotations.on('change', () => workspace.render());
    // A lexicon arriving gives the interlinear line its glosses.
    ctx.lexicons?.on('change', () => { if (ctx.state.get().interlinear) workspace.render(); });
    ctx.study?.on('change', () => workspace.render());

    applyHash();
    window.addEventListener('hashchange', applyHash);

    workspace.restore();
    refresh();
    // A link to a verse: the chapter was set above, before the tabs came
    // back; the verse is revealed once there is a page to reveal it in.
    tabsRestored = true;
    const linked = readHash();
    if (linked?.verse) workspace.openVerse(linked.book, linked.chapter, linked.verse);

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
    phone?.paint();
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
    command('reading.strongs', L('cmd.strongs'), toggleStrongs, { icon: 'tag', needsChapter: true, state: () => ctx.state.get().strongsMode === 'numbers' });
    command('reading.interlinear', L('cmd.interlinear'), toggleInterlinear, { icon: 'study', needsChapter: true, state: () => ctx.state.get().interlinear });
    command('reading.headings', L('cmd.headings'), () => toggleShown('headings', 'cmd.headings'), { icon: 'heading', needsChapter: true, state: () => ctx.state.get().headings });
    command('reading.xrefs', L('cmd.xrefs'), () => toggleShown('xrefs', 'cmd.xrefs'), { icon: 'link', needsChapter: true, state: () => ctx.state.get().xrefs });
    command('tab.detach', L('cmd.detach'), () => { const tab = workspace.activeTab; if (tab) workspace.detach(tab.id); }, { icon: 'restore' });
    command('tab.next', L('cmd.nextTab'), () => stepTab(1), { keys: 'Mod+Shift+ArrowRight', icon: 'tab-next' });
    command('tab.prev', L('cmd.prevTab'), () => stepTab(-1), { keys: 'Mod+Shift+ArrowLeft', icon: 'tab-prev' });
    command('tab.close', L('cmd.closeTab'), () => { const tab = workspace.activeTab; if (tab) workspace.closeTab(tab.id); }, { keys: 'Mod+w', icon: 'x' });
    registerShellVerbs();
  }

  /**
   * The words the palette takes as instructions. The shell owns the ones that
   * are about where the reader is; a feature owns the ones that are about what it
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

  /**
   * A command per pane, to switch it off and on.
   *
   * Generated from the registry rather than written out, so a pane added later
   * is controllable the moment it is registered and nothing has to remember to
   * wire it. The command reports what it would do now, so the palette says
   * "Hide the Notes pane" while that pane is up and the opposite while it is
   * not — a reader should not have to press it to find out which way it goes.
   *
   * Showing goes through `selectPane`, which is what a feature's own command
   * uses: the pane comes back, its sidebar opens, and it is the tab in front.
   */
  function registerPaneCommands() {
    const shown = (id) => chrome.panesShown().find((p) => p.id === id)?.shown ?? false;
    // One command for every pane rather than one each: the palette already
    // has a row per pane, and a second row per pane would double them.
    ctx.registry.command({
      id: 'pane.tab',
      title: L('cmd.paneToTab'),
      icon: 'files',
      run: () => modal.open({
        placeholder: L('ph.paneToTab'),
        items: ctx.registry.panes().map((pane) => ({ id: pane.id, title: pane.title, icon: pane.icon })),
        onPick: (item) => workspace.openPaneTab(item.id),
      }),
    });
    for (const pane of ctx.registry.panes()) {
      ctx.registry.command({
        id: `pane.${pane.id}`,
        title: L('cmd.paneShow', { name: pane.title }),
        icon: pane.icon,
        state: () => ({
          on: shown(pane.id),
          icon: pane.icon,
          title: L(shown(pane.id) ? 'cmd.paneHide' : 'cmd.paneShow', { name: pane.title }),
        }),
        run: () => {
          if (shown(pane.id)) {
            chrome.setPaneShown(pane.id, false);
            shell.notify(L('msg.paneHidden', { name: pane.title }));
          } else {
            chrome.selectPane(pane.side, pane.id);
          }
        },
      });
    }
  }

  function registerBooksPane() {
    ctx.registry.pane({
      id: 'files',
      side: 'left',
      order: 10,
      icon: 'book',
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
    shell.notify(L('msg.state', { what: L('cmd.layout'), value: L(`val.${next}`) }), 'info', { about: 'layout' });
  }

  function toggleFlag(key, label) {
    const value = !ctx.state.get()[key];
    ctx.state.set({ [key]: value });
    shell.notify(L('msg.state', { what: label, value: L(value ? 'val.on' : 'val.off') }), 'info', { about: label });
  }

  async function showAbout() {
    const native = ctx.platform.capabilities.appInfo ? await ctx.platform.capabilities.appInfo() : null;
    const built = when.date(BUILT_AT);
    shell.notify(`${L('app.name')} ${VERSION} · ${L('lbl.built', { date: built })}`
      + (native ? ` · ${native.runtime} · ${native.platform}` : ` · ${ctx.platform.id}`));
  }

  function toggleMode() {
    const next = MODES[(MODES.indexOf(ctx.state.get().mode) + 1) % MODES.length];
    ctx.state.set({ mode: next });
    shell.notify(L('msg.state', { what: L('cmd.mode'), value: L(`val.${next}`) }), 'info', { about: 'mode' });
  }

  /**
   * Strong's numbers show only where a translation carries the markup; none of
   * the published translations do today, so say that rather than toggling a
   * setting with no visible effect.
   */
  /** Headings and cross-references: on or off, and said. */
  function toggleShown(key, nameKey) {
    const next = !ctx.state.get()[key];
    ctx.state.set({ [key]: next });
    shell.notify(L('msg.state', { what: L(nameKey), value: L(next ? 'val.on' : 'val.off') }), 'info', { about: key });
  }

  /** The interlinear line: on or off, and said — or why there is nothing to show. */
  async function toggleInterlinear() {
    const next = !ctx.state.get().interlinear;
    ctx.state.set({ interlinear: next });
    const book = ctx.state.get().book;
    const testament = book <= 39 ? 'H' : 'G';
    const original = next ? await ctx.lemmas?.original(testament) : true;
    shell.notify(original
      ? L('msg.state', { what: L('cmd.interlinear'), value: L(next ? 'val.on' : 'val.off') })
      : L(testament === 'H' ? 'msg.noHebrew' : 'msg.noGreek'), 'info', { about: 'interlinear' });
  }

  /**
   * How words with a Strong's number are shown. The command (and the Guide's
   * button) turns the numbers themselves on and off, going back to how the
   * words were shown before; the status bar and the Text box offer all four.
   */
  let beforeNumbers = 'marked';
  function setStrongsMode(next) {
    const now = ctx.state.get().strongsMode;
    if (now !== 'numbers') beforeNumbers = now;
    ctx.state.set({ strongsMode: next });
    const present = document.querySelector('.chapter .strongs');
    shell.notify(present
      ? L('msg.state', { what: L('cmd.strongs'), value: L(`sw.${next}`) })
      : L('msg.noStrongs'), 'info', { about: 'strongs' });
  }
  function toggleStrongs() {
    setStrongsMode(ctx.state.get().strongsMode === 'numbers' ? beforeNumbers : 'numbers');
  }
  /** The four ways, as a menu from the control that asked. */
  function strongsMenu(anchor) {
    const now = ctx.state.get().strongsMode;
    openMenu(anchor, STRONGS_MODES.map((id) => ({
      id, title: L(`sw.${id}`), sub: L(`sw.${id}Hint`), icon: id === now ? 'check' : STRONGS_ICON[id], active: id === now, tall: true,
      run: () => setStrongsMode(id),
    })));
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
  function openStrongs(first, anchor, where = null) {
    let code = first;
    // A word can carry several numbers (the KJV tags "created" with H853, the
    // untranslated object marker, and H1254, the verb). Each is offered; the
    // popover shows one at a time.
    const codes = [...new Set((where?.codes ?? []).filter(Boolean))];
    const header = () => (codes.length > 1
      ? h('div', { class: 'pv-codes', role: 'group' }, ...codes.map((c) => h('button', {
        class: 'pv-code pv-pick',
        'aria-pressed': c === code ? 'true' : 'false',
        onclick: () => { code = c; show(); },
      }, c)))
      : h('div', { class: 'pv-code' }, code));
    // The way on to the whole study of the word, where a feature offers one.
    const study = () => (where && studyWord
      ? h('div', { class: 'pv-foot' }, h('button', {
        class: 'btn soft pv-study',
        onclick: () => {
          strongsPopover.hidden = true;
          studyWord({ code, identify: where.identify, book: where.book, chapter: where.chapter, verse: where.verse });
        },
      }, icon('study'), L('ws.open')))
      : null);
    const paint = (...children) => {
      fill(strongsPopover, header(), ...children, study());
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
          entry.kjv ? h('div', { class: 'pv-kjv' }, entry.kjv) : null,
          found.senses?.length > 1
            ? h('div', { class: 'pv-say' }, L('lex.senses', { list: found.senses.map((k) => `${found.testament}${k.toUpperCase()}`).join(', ') }))
            : null);
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
    shell.notify(L('msg.state', { what: L('cmd.theme'), value: L(`val.${next}`) }), 'info', { about: 'theme' });
  }

  // --- modal users --------------------------------------------------------

  function openPalette() {
    modal.open({
      placeholder: L('ph.palette'),
      // A command that knows what it is doing now says so: `state()` may
      // answer with the words for what pressing it would do next, which is
      // what the ribbon draws on its buttons. The palette asks the same
      // question, so "Read aloud" is "Pause" while it reads, and a pane's
      // command offers to hide the pane that is up.
      items: ctx.registry.commands().map((c) => {
        const live = typeof c.state === 'function' ? c.state() : null;
        const now = live && typeof live === 'object' ? live : null;
        return {
          id: c.id,
          title: now?.title ?? c.title,
          keys: c.keys?.replace('Mod', '⌘/Ctrl'),
          icon: now?.icon ?? c.icon ?? 'cmd',
          run: c.run,
        };
      }),
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
    // "?" is how a question starts: "? how do I bookmark" goes to whichever
    // verb takes the word "ask", with no space needed after the mark.
    const question = /^\s*\?\s*(.*)$/s.exec(text);
    if (question) {
      const verb = ctx.registry.verbs().find((v) => v.word === 'ask');
      if (!verb) return [];
      const rest = question[1].trim();
      if (!rest) return [verbHint(verb)];
      // The question put to the Guide pane first — Enter gets the whole
      // answer, explained — then the answers themselves as rows that do the
      // thing at once, where the verb can give them.
      const answers = typeof verb.suggest === 'function' ? verb.suggest(rest) : [];
      return [{ id: `verb.${verb.id}`, title: `${verb.title}: ${rest}`, sub: verb.hint ?? undefined, icon: verb.icon, run: () => verb.run(rest) }, ...answers];
    }
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
    // The two keys that open a list of things to go to still work from inside
    // one: Mod+P in the quick switcher opens the palette in its place. Ignored,
    // they fell through to the browser, and Ctrl+P printed the page.
    const FROM_A_LIST = new Set(['shell.palette', 'shell.switcher']);
    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (modal.isOpen) {
        if (!mod || e.altKey) return;
        const combo = `Mod+${e.shiftKey ? 'Shift+' : ''}${e.key.length === 1 ? e.key.toLowerCase() : e.key}`;
        const command = ctx.registry.commands().find((c) => c.keys === combo && FROM_A_LIST.has(c.id));
        if (!command) return;
        e.preventDefault();
        modal.close();
        command.run();
        return;
      }
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
    const { book, chapter, layout, syncScroll, mode, strongsMode, readingSize } = ctx.state.get();
    const label = `${workspace.bookName(book)} ${workspace.number(chapter)}`;
    const onChapter = workspace.activeTab?.kind === 'chapter';
    // A control that acts on the chapter is shown but not pressable while a
    // document tab is active, so the bar never claims to describe one.
    const chapterOnly = (button) => {
      button.disabled = !onChapter;
      button.setAttribute('aria-disabled', String(!onChapter));
      return button;
    };

    const on = (flag) => ({ class: `sb sb-flag${flag ? ' is-on' : ''}`, 'aria-pressed': String(Boolean(flag)) });
    const built = {
      translation: () => h('button', { class: 'sb', title: L('cmd.translation'), onclick: () => openTranslationPicker(0) },
        icon('book'), h('span', {}, workspace.primaryName())),
      passage: () => chapterOnly(h('button', {
        class: 'sb', title: `${workspace.englishRef(book, chapter)} — ${L('cmd.switcher')}`,
        'aria-label': `${L('cmd.switcher')}: ${workspace.englishRef(book, chapter)}`,
        onclick: () => openSwitcher(book),
      }, icon('book-open'), h('span', { lang: workspace.lang() }, label))),
      // Before any chapter has been measured there is nothing to report, and
      // "0 words" would be a claim about the passage rather than about the
      // absence of a measurement.
      words: () => h('span', { class: 'sb hide-sm', title: L('lbl.wordsIn', { ref: label }) },
        icon('quote'), h('span', {}, counts ? L('lbl.words', { n: counts.words }) : L('val.unmeasured'))),
      verses: () => h('span', { class: 'sb hide-sm', title: L('lbl.versesIn', { ref: label }) },
        icon('lay-list'), h('span', {}, counts ? L('lbl.verses', { n: counts.verses }) : L('val.unmeasured'))),
      reading: () => h('button', { class: 'sb sb-reading', title: L('cmd.reading'), onclick: (e) => readingPanel.toggle(e.currentTarget) }, icon('type'), `${readingSize}px · ${L(`val.${layout}`)}`),
      mode: () => chapterOnly(h('button', { class: 'sb', title: L('cmd.mode'), onclick: toggleMode }, icon(mode === 'source' ? 'edit' : 'eye'), L(`val.${mode}`))),
      // Which of the four ways is on is said beside the name; the press
      // offers all four, each with what it does.
      strongs: () => chapterOnly(h('button', {
        class: `sb sb-flag sb-words${strongsMode === 'plain' ? '' : ' is-on'}`, title: L('sw.title'), 'aria-haspopup': 'menu', dataset: { words: strongsMode },
        onclick: (event) => strongsMenu(event.currentTarget),
      }, icon('strongs'), h('span', {}, L('cmd.strongs')), h('span', { class: 'sb-val' }, L(`sw.${strongsMode}`)))),
      sync: () => chapterOnly(h('button', { ...on(syncScroll), title: L('cmd.sync'), onclick: () => toggleFlag('syncScroll', L('cmd.sync')) },
        icon('sync-scroll'), h('span', {}, L('cmd.sync')))),
      storage: () => h('button', { class: 'sb', title: storage.title, onclick: () => workspace.openDoc('about') },
        icon('db'), h('span', {}, storage.text)),
    };
    const shown = statusItems();
    const draw = (item) => {
      const el = built[item.id]();
      el.dataset.status = item.id;
      el.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); openStatusMenu(el, item.id); });
      return el;
    };
    const left = shown.filter((item) => item.side === 'left').map(draw);
    const right = shown.filter((item) => item.side === 'right').map(draw);
    chrome.setStatus(left, right);
  }

  /**
   * What the status bar can show, in its default order. Every item can be
   * taken off and put back, as the ribbon's buttons can: from an item's own
   * menu (right-click or long press), from the bar's empty space, and from
   * Settings → Appearance.
   */
  const STATUS_ITEMS = Object.freeze([
    { id: 'translation', side: 'left', icon: 'book', name: () => L('cmd.translation') },
    { id: 'passage', side: 'left', icon: 'book-open', name: () => L('sb.passage') },
    { id: 'words', side: 'left', icon: 'quote', name: () => L('sb.words') },
    { id: 'verses', side: 'left', icon: 'lay-list', name: () => L('sb.verses') },
    { id: 'reading', side: 'right', icon: 'type', name: () => L('cmd.reading') },
    { id: 'mode', side: 'right', icon: 'eye', name: () => L('cmd.mode') },
    { id: 'strongs', side: 'right', icon: 'strongs', name: () => L('cmd.strongs') },
    { id: 'sync', side: 'right', icon: 'sync-scroll', name: () => L('cmd.sync') },
    { id: 'storage', side: 'right', icon: 'db', name: () => L('sb.storage') },
  ]);
  const statusDefaults = () => STATUS_ITEMS.map((item) => item.id);
  function statusItems() {
    const wanted = ctx.settings.get().statusItems ?? statusDefaults();
    return wanted.map((id) => STATUS_ITEMS.find((item) => item.id === id)).filter(Boolean);
  }
  function setStatusItems(ids) {
    const order = statusDefaults().filter((id) => ids.includes(id));
    const same = order.length === STATUS_ITEMS.length;
    ctx.state.set({ statusItems: same ? null : order });
    renderStatus();
  }
  function removeStatusItem(id) {
    const before = statusItems().map((item) => item.id);
    setStatusItems(before.filter((x) => x !== id));
    const name = STATUS_ITEMS.find((item) => item.id === id)?.name() ?? id;
    chrome.notify(L('msg.statusRemoved', { name }), 'info', { action: { label: L('cmd.undo'), run: () => setStatusItems(before) } });
  }
  function openStatusAdd() {
    const held = new Set(statusItems().map((item) => item.id));
    const missing = STATUS_ITEMS.filter((item) => !held.has(item.id));
    if (!missing.length) { chrome.notify(L('msg.statusFull')); return; }
    modal.open({
      placeholder: L('ph.statusAdd'),
      items: missing.map((item) => ({ id: item.id, title: item.name(), icon: item.icon })),
      onPick: (item) => setStatusItems([...held, item.id]),
    });
  }
  function openStatusMenu(anchor, id = null) {
    const item = id ? STATUS_ITEMS.find((one) => one.id === id) : null;
    openMenu(anchor, [
      item ? { id: 'remove', title: L('cmd.statusRemove', { name: item.name() }), icon: 'x', run: () => removeStatusItem(id) } : null,
      { id: 'add', title: L('cmd.statusAdd'), icon: 'plus', run: () => openStatusAdd() },
      { id: 'reset', title: L('cmd.statusReset'), icon: 'undo', run: () => setStatusItems(statusDefaults()) },
    ].filter(Boolean));
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
        text: formatBytes(usage),
        title: [
          L('lbl.stored', { size: formatBytes(usage) }),
          quota ? L('lbl.ofQuota', { size: formatBytes(quota), pct: Math.max(1, Math.round(usage / quota * 100)) }) : null,
          persisted === true ? L('lbl.persisted') : persisted === false ? L('lbl.notPersisted') : null,
        ].filter(Boolean).join(' · '),
      };
    if (next.text === storage.text && next.title === storage.title) return;
    storage = next;
    renderStatus();
  }


  // --- address hash -------------------------------------------------------

  /**
   * The address says where the reader is: `#/19/23`, or `#/19/23/1` and
   * `#/19/23/1-3` when it was opened on a verse. A verse stays in the address
   * while the chapter does, so reloading a shared link lands on it again.
   */
  function syncHash() {
    const { book, chapter } = ctx.state.get();
    const hash = `#/${book}/${chapter}`;
    if (location.hash === hash || location.hash.startsWith(`${hash}/`)) return;
    history.replaceState(null, '', hash);
  }

  /** @returns {{ book: number, chapter: number, verse: number|null, to: number|null } | null} */
  function readHash() {
    const m = /^#\/(\d+)\/(\d+)(?:\/(\d+)(?:-(\d+))?)?$/.exec(location.hash);
    if (!m) return null;
    const book = Number(m[1]);
    if (!ctx.category.hasBook(book)) return null;
    const chapter = Math.min(Math.max(Number(m[2]), 1), ctx.category.book(book).chapters);
    const verse = m[3] ? Math.max(Number(m[3]), 1) : null;
    const to = verse && m[4] && Number(m[4]) > verse ? Number(m[4]) : null;
    return { book, chapter, verse, to };
  }

  function applyHash() {
    const found = readHash();
    if (!found) return;
    const { book, chapter, verse } = found;
    if (verse && tabsRestored) { workspace.openVerse(book, chapter, verse); return; }
    const current = ctx.state.get();
    if (current.book !== book || current.chapter !== chapter) ctx.state.set({ book, chapter });
  }

  /**
   * A link to a passage that opens for anyone: the web build's address when
   * this is not the web build, this page's own address when it is.
   */
  function passageLink({ book, chapter, verse = null, to = null }) {
    const own = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}` : ctx.config.publicUrl;
    const tail = verse ? `/${verse}${to && to !== verse ? `-${to}` : ''}` : '';
    return `${own}#/${book}/${chapter}${tail}`;
  }

  return shell;
}
