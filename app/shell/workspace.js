/**
 * Workspace: tabs, reading panes (leaves), detached windows and what keeps
 * them in step.
 *
 * A tab is a chapter or a registered doc (Library, Settings). Each chapter tab
 * carries its own passage; the active one mirrors into the shared state, which
 * is what the tree, the status bar and the panes read. A chapter tab renders
 * one leaf per parallel translation, and leaves share the passage, so row
 * alignment and synchronised scrolling work off verse spans rather than pixel
 * offsets — a translation that merges 17–18 still lines up.
 */

import { alignChapter } from '../core/align.js';
import { SOURCE_FORMATS } from '../core/settings.js';
import { createResolver } from '../core/reference.js';
import { fromMarkdown, toMarkdown } from '../core/source.js';
import { localizeNumber } from '../core/translation.js';
import { h } from './dom.js';
import { wirePaneDrag, wireTabDrag } from './dragdrop.js';
import { createFloats } from './floats.js';
import { wireFades } from './fade.js';
import { bookCodes } from '../core/formats/books.js';
import { write, writerById } from '../core/formats/write.js';
import { saveText } from '../services/transfer.js';
import { icon } from './icons.js';
import { L } from './i18n.js';
import { openMenu } from './menu.js';
import { fitStrip, watchStrip } from './overflow.js';
import { chapterNote, LAYOUTS } from './reading.js';

const MAX_PANES = 4;
/** Where the reader's text-direction corrections are kept, one per translation. */
const DIR_KEY = 'direction';

export function createWorkspace(ctx, chrome) {
  const { category, registry, state, store } = ctx;
  const tabs = [];
  let activeId = null;
  let seq = 1;
  let disposeDoc = null;
  /** Which document is mounted in the workspace right now, if any. */
  let mountedDoc = null;
  let pendingReveal = null;
  let revealTimer = null;
  const openTranslations = new Map(); // identify -> { meta, resolver }
  let primaryMeta = null;             // meta of pane 0, for localised book names
  let primaryResolver = null;         // its reference resolver, for wikilinks in notes

  const floats = createFloats(ctx, { render: () => render(), dockTarget: () => chrome.tabStrip });

  wireTabDrag(chrome.tabStrip, {
    // One splice on release; the strip is never rebuilt mid-drag.
    commit: (from, to) => {
      if (from === to) return;
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab);
      activate(tab.id);
      persistTabs();
    },
    detach: (id) => detach(id),
    activate: (id) => {
      // Pressing the tab that is already active, where it is the only one on
      // screen, is how the reader reaches the rest.
      if (id === activeId && chrome.isDrawerLayout?.()) { openTabSwitcher(); return; }
      activate(id);
    },
    hint: floats.hint,
  });
  wirePaneDrag(chrome.panes, { move: movePane });

  /**
   * The translation as it will be read: its stored form, with the reader's own
   * correction to the text direction applied if they made one. A file that
   * declares the wrong direction is not rare, and a reader can see it at a
   * glance while nothing but another download would otherwise change it.
   */
  async function openTranslation(identify) {
    const stored = await store.getMeta(identify);
    const override = ctx.records.get(DIR_KEY, {})?.[identify] ?? null;
    const meta = override && override !== stored.info.language.textdirection
      ? { ...stored, info: { ...stored.info, language: { ...stored.info.language, textdirection: override } } }
      : stored;
    const key = `${identify}@${meta.version}@${meta.installedAt}@${override ?? ''}`;
    const cached = openTranslations.get(identify);
    if (cached?.key === key) return cached;
    const entry = { key, meta, resolver: createResolver({ category, books: meta.books, aliases: await ctx.aliases(identify) }) };
    openTranslations.set(identify, entry);
    return entry;
  }

  /** Set, or clear with null, the reader's correction for one translation. */
  async function setDirection(identify, direction) {
    const held = { ...(ctx.records.get(DIR_KEY, {}) ?? {}) };
    if (direction) held[identify] = direction; else delete held[identify];
    await ctx.records.save(DIR_KEY, held);
    openTranslations.delete(identify);
    await render();
  }

  const directionOf = (identify) => ctx.records.get(DIR_KEY, {})?.[identify] ?? null;

  // --- tabs ---------------------------------------------------------------

  function newTab(kind, book, chapter) {
    const tab = { id: `t${seq++}`, kind, book, chapter };
    tabs.push(tab);
    return tab;
  }

  function activeTab() {
    return tabs.find((t) => t.id === activeId) ?? null;
  }

  function activate(id) {
    activeId = id;
    const tab = activeTab();
    // Which tab is in front is recorded before anything else, because moving to
    // a tab on another passage hands the rest of the work to the state change —
    // and that path used to return without ever writing the tab down.
    persistTabs();
    if (tab?.kind === 'chapter') {
      const { book, chapter } = state.get();
      if (tab.book !== book || tab.chapter !== chapter) { state.set({ book: tab.book, chapter: tab.chapter }); return; }
    }
    render();
  }

  function openChapter(book, chapter, { newTab: wantsNew = false } = {}) {
    const current = activeTab();
    if (wantsNew || current?.kind !== 'chapter') {
      activeId = newTab('chapter', book, chapter).id;
      persistTabs();
    }
    const here = state.get();
    if (here.book !== book || here.chapter !== chapter) { state.set({ book, chapter }); return Promise.resolve(); }
    return render();
  }

  function openDoc(id) {
    if (!registry.getDoc(id)) throw new Error(`workspace: no doc "${id}" is registered`);
    const existing = tabs.find((t) => t.kind === id);
    activeId = existing ? existing.id : newTab(id).id;
    persistTabs();
    return render();
  }

  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    tabs.splice(i, 1);
    if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
    persistTabs();
    return activate(activeId ?? '');
  }

  /** Pull a tab out of the strip into a detached window. */
  function detach(id) {
    const i = tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    const [tab] = tabs.splice(i, 1);
    if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
    floats.open(tab);
    persistTabs();
  }

  /** Put a detached tab back in the strip. */
  function adopt(tab) {
    tabs.push(tab);
    activeId = tab.id;
    persistTabs();
    render();
  }

  /** The active chapter tab follows the shared passage. */
  function syncActiveTab() {
    const tab = activeTab();
    if (tab?.kind !== 'chapter') return;
    const { book, chapter } = state.get();
    if (tab.book === book && tab.chapter === chapter) return;
    tab.book = book;
    tab.chapter = chapter;
    persistTabs();
  }

  function persistTabs() {
    const snapshot = tabs.map((t) => (t.kind === 'chapter' ? { kind: 'chapter', book: t.book, chapter: t.chapter } : { kind: t.kind }));
    const index = Math.max(tabs.findIndex((t) => t.id === activeId), 0);
    const stored = state.get();
    const same = stored.tabs.length === snapshot.length
      && stored.activeTab === index
      && stored.tabs.every((t, i) => t.kind === snapshot[i].kind && t.book === snapshot[i].book && t.chapter === snapshot[i].chapter);
    if (!same) state.set({ tabs: snapshot, activeTab: index });
  }

  /**
   * Reopen tabs: the ones passed in (a chrome rebuild) or the ones from the
   * last session. Falls back to the last passage.
   */
  function restore(fromTabs, fromIndex) {
    const stored = state.get();
    // A reader who does not want last session's tabs back still wants the
    // passage they left off at, so the fallback below opens it. A chrome
    // rebuild passes its own list and is never the start of a session.
    const saved = fromTabs ?? (stored.restoreTabs === false ? [] : stored.tabs);
    const index = fromIndex ?? stored.activeTab;
    const { book, chapter } = stored;
    for (const entry of saved) {
      if (entry.kind === 'chapter') newTab('chapter', entry.book, entry.chapter);
      else if (registry.getDoc(entry.kind)) newTab(entry.kind);
    }
    if (!tabs.length) newTab('chapter', book, chapter);
    activeId = (tabs[index] ?? tabs[0]).id;
    const tab = activeTab();
    if (tab.kind === 'chapter' && (tab.book !== book || tab.chapter !== chapter)) state.set({ book: tab.book, chapter: tab.chapter });
  }

  // --- panes --------------------------------------------------------------

  async function addPane() {
    if (activeTab()?.kind !== 'chapter') { chrome.notify(L('msg.paneNeedsChapter')); return; }
    const installed = (await store.list()).map((t) => t.identify);
    const open = panesOf(state.get());
    if (open.length >= MAX_PANES) { chrome.notify(L('msg.limitPanes', { n: MAX_PANES })); return; }
    const free = installed.filter((id) => !open.includes(id));
    if (!free.length) { chrome.notify(L('msg.allOpen')); return; }
    state.set({ parallel: [...open.slice(1), free[0]] });
  }

  function closePane(index) {
    const open = panesOf(state.get());
    if (index === 0 || index >= open.length) return;
    state.set({ parallel: open.slice(1).filter((_, i) => i !== index - 1) });
  }

  function setPaneTranslation(index, identify) {
    const open = panesOf(state.get());
    if (index === 0) { state.set({ translation: identify }); return; }
    const rest = open.slice(1);
    rest[index - 1] = identify;
    state.set({ parallel: rest });
  }

  /** Reorder the panes; pane 0 is the primary translation. */
  function movePane(from, to) {
    const open = panesOf(state.get());
    if (from === to || from >= open.length || to >= open.length) return;
    const next = [...open];
    next.splice(to, 0, ...next.splice(from, 1));
    state.set({ translation: next[0], parallel: next.slice(1) });
  }

  function panesOf({ translation, parallel }) {
    return [translation, ...(parallel ?? [])].filter(Boolean);
  }

  function step(delta) {
    let { book, chapter } = state.get();
    chapter += delta;
    if (chapter < 1) {
      if (!category.hasBook(book - 1)) return;
      book -= 1;
      chapter = category.book(book).chapters;
    } else if (chapter > category.book(book).chapters) {
      if (!category.hasBook(book + 1)) return;
      book += 1;
      chapter = 1;
    }
    state.set({ book, chapter });
  }

  // --- rendering ----------------------------------------------------------

  /** Strips already being watched for a change of width. */
  const watchedStrips = new WeakSet();

  function renderTabs() {
    // More tabs than room is ordinary — a narrow window has room for one — so
    // the ones that do not fit are hidden whole and listed behind a button,
    // the same bargain a sidebar's pane strip makes. In the narrow layout this
    // button is how the reader reaches the other tabs at all.
    const more = h('button', {
      class: 'tab-more no-drag', hidden: true, 'aria-haspopup': 'menu',
      title: L('cmd.moreTabs'), 'aria-label': L('cmd.moreTabs'),
      onclick: (e) => openTabMenu(e.currentTarget),
    }, icon('more'));

    chrome.tabStrip.replaceChildren(...tabs.map((tab) => {
      const doc = tab.kind === 'chapter' ? null : registry.getDoc(tab.kind);
      const title = doc ? doc.title : `${bookLabel(tab.book)} ${localNumber(tab.chapter)}`;
      return h('div', {
        // Activation comes from the tab drag: a press that never travels is a
        // click, so a drag never costs the reader an activation.
        class: `tab${tab.id === activeId ? ' is-active' : ''}`, role: 'tab', dataset: { tab: tab.id, kind: tab.kind },
        // The label may be in a script the reader cannot read; the canon's own
        // name is always here for them.
        title: doc ? doc.title : englishRef(tab.book, tab.chapter),
        'aria-label': doc ? doc.title : englishRef(tab.book, tab.chapter),
        ondblclick: () => detach(tab.id),
      },
        icon(doc ? doc.icon : 'book-open'),
        h('span', { class: 't-name', lang: doc ? '' : primaryLang() }, title),
        h('button', {
          class: 't-close', title: L('cmd.closeTab'), 'aria-label': L('cmd.closeTab'),
          onclick: (e) => { e.stopPropagation(); closeTab(tab.id); },
        }, icon('x')),
        );
    }),
    more,
    h('button', {
      class: 'tab-new no-drag', title: L('cmd.newTab'), 'aria-label': L('cmd.newTab'), onclick: () => newChapterTab(),
    }, icon('plus')));
    fitTabs();
    watchStrip(chrome.tabStrip, fitTabs, watchedStrips);
  }

  function fitTabs() {
    const strip = chrome.tabStrip;
    fitStrip(strip, {
      items: [...strip.querySelectorAll('.tab')],
      more: strip.querySelector('.tab-more'),
      fixed: [strip.querySelector('.tab-new')].filter(Boolean),
    });
  }

  /**
   * Every open tab as a list, marking the ones already on the strip: a menu
   * whose contents change with the width of the window is a menu nobody can
   * learn.
   */
  function openTabMenu(anchor) {
    const shown = new Set([...chrome.tabStrip.querySelectorAll('.tab:not([hidden])')].map((el) => el.dataset.tab));
    openMenu(anchor, [
      ...tabs.map((tab) => {
        const doc = tab.kind === 'chapter' ? null : registry.getDoc(tab.kind);
        return {
          id: tab.id,
          icon: doc ? doc.icon : 'book-open',
          title: doc ? doc.title : `${bookLabel(tab.book)} ${localNumber(tab.chapter)}`,
          active: tab.id === activeId,
          quiet: shown.has(tab.id),
          run: () => activate(tab.id),
        };
      }),
      { id: 'new', icon: 'plus', title: L('cmd.newTab'), run: () => newChapterTab() },
    ]);
  }

  /** Every open tab as a list, plus a way to open or close one. */
  function openTabSwitcher() {
    const items = tabs.map((tab) => {
      const doc = tab.kind === 'chapter' ? null : registry.getDoc(tab.kind);
      return {
        id: tab.id,
        icon: doc ? doc.icon : 'book-open',
        title: doc ? doc.title : `${bookLabel(tab.book)} ${localNumber(tab.chapter)}`,
        sub: [doc ? '' : englishRef(tab.book, tab.chapter), tab.id === activeId ? L('lbl.openNow') : '']
          .filter(Boolean).join(' · '),
      };
    });
    items.push({ act: 'new', icon: 'plus', title: L('cmd.newTab') });
    if (tabs.length > 1) items.push({ act: 'close', icon: 'x', title: L('cmd.closeTab') });
    ctx.shell.pick({
      placeholder: L('ph.tabs'),
      items,
      onPick: (item) => {
        if (item.act === 'new') { newChapterTab(); return; }
        if (item.act === 'close') { if (activeId) closeTab(activeId); return; }
        activate(item.id);
      },
    });
  }

  /** A second tab on the passage in view, then the switcher to send it somewhere. */
  function newChapterTab() {
    const { book, chapter } = state.get();
    activeId = newTab('chapter', book, chapter).id;
    renderTabs();
    persistTabs();
    render();
    ctx.shell.openSwitcher(book);
  }

  /**
   * Names come from three places, in this order: the translation in front of
   * the reader, the language pack for its language, and the canon — which is
   * always English, and is therefore also what every control offers as its
   * accessible name (see `englishBook`).
   */
  const pack = () => ctx.langPacks.forMeta(primaryMeta);

  function bookLabel(book) {
    return primaryMeta?.books[book]?.name ?? pack()?.books[book]?.name ?? category.book(book).name;
  }

  /** The canon's own name, for a reader who cannot read the script. */
  const englishBook = (book) => category.book(book).name;
  const englishTestament = (id) => category.testaments.find((t) => t.id === id)?.name ?? '';

  /** A passage as the canon names it: what a tooltip says under a localised label. */
  function englishRef(book, chapter, verse) {
    const base = chapter === undefined ? englishBook(book) : `${englishBook(book)} ${chapter}`;
    return verse === undefined ? base : `${base}:${verse}`;
  }

  /** A number in the primary translation's own digits. */
  function localNumber(value) {
    const digit = primaryMeta?.digit?.length ? primaryMeta.digit : pack()?.digit;
    return localizeNumber(value, digit);
  }

  /** The tag for whatever script the primary translation is written in. */
  function primaryLang() {
    return primaryMeta?.info.language.code ?? '';
  }

  /** Which way that script runs, for anything quoting it outside the page. */
  function primaryDirection() {
    return primaryMeta?.info.language.textdirection ?? 'ltr';
  }

  /** The testament as the translation names it, then as its language does. */
  function testamentLabel(id) {
    return primaryMeta?.testament?.[id]?.info?.name
      ?? pack()?.testaments[id]?.name
      ?? englishTestament(id);
  }

  async function ensurePrimaryMeta() {
    const { translation } = state.get();
    if (primaryMeta?.identify === translation || !translation) return;
    const installed = await store.list();
    if (!installed.some((t) => t.identify === translation)) return;
    const primary = await openTranslation(translation);
    primaryMeta = primary.meta;
    primaryResolver = primary.resolver;
    renderTabs();
    ctx.shell.refreshNames?.();
    state.set({ names: (state.get().names ?? 0) + 1 });
    loadPack();
  }

  /**
   * Ask for the language pack behind the translation now in front of the
   * reader. It arrives late or not at all; when it does, every name in the app
   * is repainted from the same counter the translation itself uses.
   */
  function loadPack() {
    const meta = primaryMeta;
    if (!meta) return;
    const before = pack();
    ctx.langPacks.ensureFor(meta).then((next) => {
      if (!next || next === before || primaryMeta !== meta) return;
      renderTabs();
      ctx.shell.refreshNames?.();
      state.set({ names: (state.get().names ?? 0) + 1 });
    }, () => { /* a missing pack is normal: the canon names the books */ });
  }

  /**
   * The crumb bar reads translation ▸ testament ▸ book ▸ chapter, and every
   * crumb whose label is in the translation's language carries the canon's
   * English name as its accessible name — a reader who cannot read the script
   * can still tell what a click will open.
   */
  function crumbs(pane, book, chapter) {
    const canon = category.book(book);
    const sep = () => h('span', { class: 'crumb-sep' }, '/');
    const testament = testamentLabel(canon.testament);
    const bookName = bookLabel(book);

    return h('div', { class: 'crumbs' },
      h('button', {
        class: 'crumb crumb-tr', dataset: { crumb: 'translation' },
        title: `${pane.meta.info.name} — ${L('cmd.translation')}`,
        'aria-label': `${L('cmd.translation')}: ${pane.meta.info.name}`,
        onclick: () => ctx.shell.openTranslationPicker(pane.index),
      }, pane.meta.info.shortname),
      sep(),
      h('button', {
        class: 'crumb', dataset: { crumb: 'testament' }, 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
        title: englishTestament(canon.testament), 'aria-label': englishTestament(canon.testament),
        onclick: (e) => ctx.shell.openCrumb(e.currentTarget, 'books', { book, chapter }),
      }, h('span', { lang: primaryLang() }, testament)),
      sep(),
      h('button', {
        class: 'crumb', dataset: { crumb: 'book' }, 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
        title: englishBook(book), 'aria-label': englishBook(book),
        onclick: (e) => ctx.shell.openCrumb(e.currentTarget, 'books', { book, chapter }),
      }, h('span', { class: 'cb-full', lang: primaryLang() }, bookName), h('span', { class: 'cb-short' }, canon.shortname)),
      sep(),
      h('button', {
        class: 'crumb is-current', 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
        title: englishRef(book, chapter), 'aria-label': englishRef(book, chapter),
        onclick: (e) => ctx.shell.openCrumb(e.currentTarget, 'chapters', { book, chapter }),
      }, localNumber(chapter)));
  }

  async function renderPanes() {
    const tab = activeTab();

    /**
     * A document already on screen is left alone.
     *
     * Every state change runs this — a theme cycled, a chapter stepped, a
     * translation installed — and the document tabs were being torn down and
     * mounted again each time. That is how the Library came to scroll back to
     * the top whenever a button on it was pressed: not the list repainting,
     * but the whole page being built again from nothing, which is also what it
     * looked like. Documents repaint themselves through their own listeners,
     * so nothing is lost by leaving them standing.
     */
    if (tab && tab.kind !== 'chapter' && mountedDoc === tab.kind && chrome.panes.querySelector(`.leaf[data-doc="${tab.kind}"]`)) {
      await ensurePrimaryMeta();
      return;
    }

    if (typeof disposeDoc === 'function') { disposeDoc(); disposeDoc = null; }
    mountedDoc = null;

    if (!tab) {
      chrome.panes.replaceChildren(emptyLeaf(L('empty.workspace'), L('empty.workspaceAct'),
        () => openChapter(state.get().book, state.get().chapter, { newTab: true })));
      return;
    }

    if (tab.kind !== 'chapter') {
      const doc = registry.getDoc(tab.kind);
      const body = h('div', { class: 'leaf-scroll scroll' });
      chrome.panes.replaceChildren(h('div', { class: 'leaf', dataset: { doc: doc.id } }, body));
      // A document that throws on mount leaves the tab open and says why, so
      // the reader can close it and carry on reading.
      try {
        disposeDoc = doc.mount(body) ?? null;
        mountedDoc = doc.id;
      } catch (err) {
        disposeDoc = null;
        body.replaceChildren(h('div', { class: 'pane-broken' },
          h('p', {}, L('msg.paneBroken', { name: doc.title })), h('pre', {}, err.message)));
      }
      // Book names come from the primary translation; load it even when no
      // chapter is on screen, or the tree and the switcher show canon names.
      await ensurePrimaryMeta();
      return;
    }

    const installed = await store.list();
    if (!installed.length) {
      chrome.panes.replaceChildren(emptyLeaf(L('msg.noTranslations'), L('msg.openLibrary'), () => openDoc('library')));
      return;
    }

    const open = panesOf(state.get());
    const order = open.filter((id) => installed.some((t) => t.identify === id));
    if (!order.length) { state.set({ translation: installed[0].identify, parallel: [] }); return; }
    /**
     * A translation named by the state but no longer installed is repaired
     * here, not rendered around.
     *
     * Filtering at paint time made the screen right and left the state wrong,
     * and everything that is not this function reads the state: `closePane`,
     * `setPaneTranslation` and `movePane` index into the unfiltered list, so
     * closing the second column closed the first; and every feature that asks
     * for `state.translation` — the outline, the card studio, reading aloud,
     * the exports, the word count in the status bar — asked the store for a
     * translation that had been deleted and got an exception per repaint.
     */
    if (order.length !== open.length) {
      state.set({ translation: order[0], parallel: order.slice(1) });
      return;
    }

    const { book, chapter } = state.get();
    const loaded = await Promise.all(order.map(async (identify, index) => {
      const { meta, resolver } = await openTranslation(identify);
      return { identify, index, meta, resolver, verses: await store.getChapter(identify, book, chapter) };
    }));

    // The translation carries its own book names, and it loads after the first
    // paint. When the primary one changes, everything that shows a book name —
    // tabs, tree, status bar, and any pane that labels a passage — is stale, so
    // bump a counter the whole app is already subscribed to.
    const primaryBefore = primaryMeta?.identify ?? null;
    primaryMeta = loaded[0].meta;
    primaryResolver = loaded[0].resolver;
    if (primaryMeta.identify !== primaryBefore) {
      renderTabs();
      ctx.shell.refreshNames?.();
      state.set({ names: (state.get().names ?? 0) + 1 });
      loadPack();
    }

    const leaves = loaded.map((pane) => buildLeaf(pane, loaded, { book, chapter }));
    const children = [];
    leaves.forEach((leaf, i) => {
      if (i > 0) children.push(h('div', { class: 'leaf-divider' }));
      children.push(leaf);
    });
    chrome.panes.replaceChildren(...children);

    alignRows(loaded, leaves);
    wireSync(leaves);
    wireFades(chrome.panes);
    if (pendingReveal !== null) reveal(pendingReveal);
  }

  /**
   * Detached windows render the same leaf (or the same doc), with their own
   * passage. A doc mounted in a float is a second, independent mount.
   */
  async function renderFloats() {
    for (const float of floats.list()) {
      const { tab } = float;
      const doc = tab.kind === 'chapter' ? null : registry.getDoc(tab.kind);
      floats.setName(float.id, doc ? doc.title : `${bookLabel(tab.book)} ${tab.chapter}`);

      if (doc) {
        if (float.mountedDoc === doc.id) continue; // already mounted; it repaints itself
        float.dispose?.();
        const body = h('div', { class: 'leaf-scroll scroll' });
        float.body.replaceChildren(h('div', { class: 'leaf', dataset: { doc: doc.id } }, body));
        try {
          float.dispose = doc.mount(body) ?? null;
        } catch (err) {
          float.dispose = null;
          body.replaceChildren(h('div', { class: 'pane-broken' },
            h('p', {}, L('msg.paneBroken', { name: doc.title })), h('pre', {}, err.message)));
        }
        float.mountedDoc = doc.id;
        continue;
      }

      const identify = state.get().translation;
      if (!identify) continue;
      const { meta, resolver } = await openTranslation(identify);
      const verses = await store.getChapter(identify, tab.book, tab.chapter);
      const pane = { identify, index: 0, meta, resolver, verses };
      float.body.replaceChildren(buildLeaf(pane, [pane], { book: tab.book, chapter: tab.chapter }, { float: float.id }));
    }
  }

  function buildLeaf(pane, all, { book, chapter }, { float = null } = {}) {
    const { mode, layout, strongs } = state.get();
    const annotations = ctx.annotations.chapterIndex(book, chapter);
    const compare = pane.index > 0;

    const body = mode === 'source' && !compare
      ? sourceView(pane, { book, chapter })
      : chapterNote({
        ctx, meta: pane.meta, resolver: pane.resolver, verses: pane.verses, book, chapter,
        compare, layout, annotations, strongs,
        primaryVerses: compare ? all[0].verses : null,
        // A cross-reference names a verse, and used to arrive at the top of
        // the chapter with nothing marked — the one link in the app that did
        // not show the reader what it had brought them to.
        onRef: (ref, options = {}) => (ref.verse
          ? openVerse(ref.book, ref.chapter, ref.verse, options)
          : openChapter(ref.book, ref.chapter, options)),
        onPeek: (ref, anchor) => ctx.shell.openPeek(anchor, ref),
        onVerse: (verse, anchor, options) => ctx.shell.openVerseBar(anchor, { book, chapter, verse }, options),
        onStrongs: (code, anchor) => ctx.shell.openStrongs(code, anchor),
        onRepair: (identify) => ctx.shell.repairTranslation(identify),
      });

    const dataset = { pane: pane.index, translation: pane.identify, role: compare ? 'compare' : 'primary' };
    if (float) dataset.float = float;
    return h('div', { class: 'leaf', dataset },
      h('div', { class: 'leaf-head' },
        compare
          ? h('div', { class: 'crumbs' }, h('button', {
            class: 'crumb crumb-tr', title: `${pane.meta.info.name} — ${L('cmd.translation')}`,
            onclick: () => ctx.shell.openTranslationPicker(pane.index),
          }, pane.meta.info.shortname))
          : crumbs(pane, book, chapter),
        // In source mode the format, the copy and the save sit here rather than
        // in a band of their own over the text: the text is the point, and a
        // toolbar is a strip of workspace spent on three controls.
        mode === 'source' && !compare ? h('button', {
          class: 'tr-btn src-btn', 'aria-haspopup': 'menu',
          title: L('src.pick'), 'aria-label': L('src.pick'),
          onclick: (e) => openSourceMenu(e.currentTarget, book, chapter, pane),
        }, icon('code'), h('span', { class: 'src-btn-n' }, L(`src.fmt.${state.get().sourceFormat ?? 'markdown'}`))) : null,
        h('button', {
          class: 'tr-btn', title: L('cmd.translationInfo'), 'aria-label': L('cmd.translationInfo'),
          onclick: (e) => ctx.shell.openTranslationInfo(e.currentTarget, pane.meta),
        }, icon('info')),
        !float && compare ? h('button', {
          class: 'leaf-close', title: L('cmd.closeParallel'), 'aria-label': L('cmd.closeParallel'),
          onclick: () => closePane(pane.index),
        }, icon('x')) : null),
      h('div', { class: 'leaf-scroll scroll' }, body));
  }

  /** Source mode: the chapter as Markdown; only the notes may be edited. */
  /**
   * The chapter as a file.
   *
   * It used to be Markdown and only Markdown, in a textarea with no way to copy
   * what was in it. It is now whichever format the reader asks for — which is
   * the same set of writers the library exports with, so this doubles as the
   * demonstration of what this app does when it reads somebody else's file: the
   * same chapter, as USFM, as OSIS, as our own JSON, side by side with the
   * reading.
   *
   * **Markdown is the only editable one**, and that is deliberate rather than
   * unfinished. The round trip works because `## Notes` is a boundary the
   * reader's own material sits below; USFM and OSIS have no such line, and a
   * textarea that silently discards what is typed into it is worse than one
   * that says it is a view.
   */
  function sourceView(pane, { book, chapter }) {
    const format = state.get().sourceFormat ?? 'markdown';
    const notes = ctx.annotations.forChapter(book, chapter).notes;
    const editable = format === 'markdown';

    const original = editable
      ? toMarkdown({ meta: pane.meta, verses: pane.verses, book, chapter, bookName: bookLabel(book), notes })
      : writeChapter(format, pane, book, chapter);

    const area = h('textarea', {
      class: 'source scroll', spellcheck: 'false', dir: 'auto',
      readonly: editable ? undefined : '',
      'aria-label': L('src.area', { format: L(`src.fmt.${format}`) }),
    });
    area.value = original;
    if (!editable) return area;

    area.addEventListener('blur', async () => {
      if (area.value === original) return;
      try {
        const { notes: edited } = fromMarkdown(area.value, original);
        await ctx.annotations.replaceChapterNotes(book, chapter, edited);
        chrome.notify(L('msg.sourceSaved'));
      } catch (err) {
        chrome.notify(err.message, 'error');
        area.value = original;
      }
    });
    return area;
  }

  /**
   * Which format to look at this chapter in, and the two things anybody looking
   * at a file wants to do with it.
   *
   * Both used to be in a toolbar over the text. One button in the crumb bar
   * says which format is showing *and* opens everything else, which is a strip
   * of workspace given back.
   */
  function openSourceMenu(anchor, book, chapter, pane) {
    const now = state.get().sourceFormat ?? 'markdown';
    const area = () => anchor.closest('.leaf')?.querySelector('textarea.source');
    const stem = `${String(book).padStart(2, '0')}-${bookCodes(book).usfm || book}-${pane.meta.identify}-${chapter}`;
    openMenu(anchor, [
      ...SOURCE_FORMATS.map((id) => ({
        id,
        title: L(`src.fmt.${id}`),
        sub: id === 'markdown' ? L('src.editableShort') : L('src.readonlyShort'),
        icon: id === now ? 'check' : 'code',
        active: id === now,
        run: () => state.set({ sourceFormat: id }),
      })),
      {
        id: 'copy',
        title: L('src.copy'),
        icon: 'copy',
        run: async () => {
          const node = area();
          if (!node) return;
          try {
            await navigator.clipboard.writeText(node.value);
            chrome.notify(L('msg.copied', { what: L(`src.fmt.${now}`) }));
          } catch {
            chrome.notify(L('src.noClipboard'), 'error');
          }
        },
      },
      {
        id: 'save',
        title: L('src.save'),
        icon: 'download',
        run: () => {
          const node = area();
          if (node) saveText(`${stem}.${extensionOf(now)}`, node.value);
        },
      },
    ]);
  }

  const extensionOf = (format) => (writerById(format)?.ext ?? 'txt');

  /** One chapter, through the same writers the library exports with. */
  function writeChapter(format, pane, book, chapter) {
    try {
      const files = write(format, {
        meta: pane.meta,
        chapters: [{ book, chapter, verses: pane.verses ?? {} }],
        bookName: () => bookLabel(book),
      });
      return files.map((file) => file.text).join('\n');
    } catch (err) {
      return `${err.message}\n`;
    }
  }

  function emptyLeaf(message, action, run) {
    return h('div', { class: 'leaf' }, h('div', { class: 'leaf-scroll scroll' },
      h('div', { class: 'state' },
        icon('book-open'),
        h('p', {}, message),
        h('button', { class: 'btn primary', onclick: run }, action))));
  }

  /**
   * Give every verse group the same height in each pane, so the columns stay
   * level however the translations merge verses.
   */
  function alignRows(loaded, leaves) {
    if (leaves.length < 2 || !state.get().alignRows || state.get().mode === 'source') return;
    const rows = alignChapter(loaded.map((p) => ({ id: p.identify, verses: p.verses })));
    const measure = () => {
      for (const leaf of leaves) {
        for (const el of leaf.querySelectorAll('.vblock')) el.style.minHeight = '';
        const chapter = leaf.querySelector('.chapter');
        if (chapter) chapter.style.paddingTop = '';
      }
      // The heads differ in height (a parallel pane names the translation, not
      // the chapter), so the first verse of each column is levelled first.
      const firsts = leaves.map((leaf) => leaf.querySelector('.vblock'));
      if (firsts.every(Boolean)) {
        const tops = firsts.map((b) => b.getBoundingClientRect().top - b.closest('.leaf-scroll').getBoundingClientRect().top);
        const lowest = Math.max(...tops);
        leaves.forEach((leaf, i) => {
          const chapter = leaf.querySelector('.chapter');
          if (chapter && tops[i] < lowest) chapter.style.paddingTop = `${lowest - tops[i]}px`;
        });
      }
      for (const row of rows) {
        const blocks = loaded.map((p, i) => row.cells[p.identify].map((key) => leaves[i].querySelector(`.vblock[data-verse="${key}"]`)).filter(Boolean));
        const heights = blocks.map((group) => group.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0));
        const tallest = Math.max(...heights);
        blocks.forEach((group, i) => {
          const last = group.at(-1);
          if (last && heights[i] < tallest) last.style.minHeight = `${last.getBoundingClientRect().height + (tallest - heights[i])}px`;
        });
      }
    };
    requestAnimationFrame(measure);
  }

  /** Scrolling one pane moves the others to the same verse, not the same pixel. */
  function wireSync(leaves) {
    if (leaves.length < 2) return;
    const scrolls = leaves.map((leaf) => leaf.querySelector('.leaf-scroll'));
    let leader = null;
    for (const [i, scroller] of scrolls.entries()) {
      scroller.addEventListener('scroll', () => {
        if (!state.get().syncScroll || (leader !== null && leader !== i)) return;
        leader = i;
        const top = topVerse(scroller);
        for (const [j, other] of scrolls.entries()) {
          if (j === i || !top) continue;
          const twin = other.querySelector(`.vblock[data-verse="${top.verse}"]`) ?? coveringVerse(other, top.verse);
          if (twin) other.scrollTop += twin.getBoundingClientRect().top - top.offset;
        }
        clearTimeout(scroller.dataset.timer);
        scroller.dataset.timer = setTimeout(() => { leader = null; }, 120);
      }, { passive: true });
    }
  }

  function topVerse(scroller) {
    const edge = scroller.getBoundingClientRect().top + 8;
    for (const el of scroller.querySelectorAll('.vblock')) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom >= edge) return { verse: Number(el.dataset.verse), offset: rect.top };
    }
    return null;
  }

  function coveringVerse(scroller, verse) {
    if (!scroller) return null;
    for (const el of scroller.querySelectorAll('.vblock')) {
      if (Number(el.dataset.verse) <= verse && Number(el.dataset.span) >= verse) return el;
    }
    return null;
  }

  function render() {
    syncActiveTab();
    renderTabs();
    // Detached windows are painted whatever the docked tab shows.
    return renderPanes()
      .then(renderFloats)
      .catch((err) => chrome.notify(err.message, 'error'));
  }

  /** Scroll a verse into view in the primary pane and flash it. */
  function reveal(verse) {
    const leaf = chrome.panes.querySelector('.leaf[data-pane="0"]');
    const block = leaf?.querySelector(`.vblock[data-verse="${verse}"]`) ?? coveringVerse(leaf?.querySelector('.leaf-scroll'), verse);
    if (!block) return;
    block.scrollIntoView({ block: 'center' });
    const line = block.querySelector('.verse');
    line?.classList.add('is-hit');
    setTimeout(() => line?.classList.remove('is-hit'), 1600);
  }

  /**
   * Open a passage and flash the verse once the chapter is on screen.
   *
   * `{ newTab }` is forwarded rather than dropped: a reference followed into a
   * new tab is still a reference to a verse, and arriving at the top of the
   * chapter instead would be the wrong place by a page.
   */
  function openVerse(book, chapter, verse, { newTab: wantsNew = false } = {}) {
    pendingReveal = verse;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { pendingReveal = null; }, 800);
    const current = state.get();
    if (!wantsNew && current.book === book && current.chapter === chapter && activeTab()?.kind === 'chapter') return render();
    return openChapter(book, chapter, { newTab: wantsNew });
  }

  return {
    openChapter, openDoc, closeTab, addPane, closePane, setPaneTranslation, movePane, step, render, openVerse, reveal,
    newChapterTab, openTabSwitcher,
    detach, adopt, restore, activate,
    floats,
    panes: () => panesOf(state.get()),
    bookName: bookLabel,
    testamentName: testamentLabel,
    englishBook,
    englishTestament,
    englishRef,
    lang: primaryLang,
    primaryDirection,
    number: localNumber,
    setDirection,
    directionOf,
    /**
     * Does the translation in front of the reader carry this book? Before one
     * is loaded the answer is yes for everything: the canon is what is on
     * screen, and dimming the whole list while a file loads would be a lie.
     */
    hasBook: (book) => !primaryMeta || Boolean(primaryMeta.books[book]),
    primaryName: () => primaryMeta?.info.shortname ?? state.get().translation ?? '–',
    /** Reference resolver of the primary translation, for wikilinks in notes. */
    resolver: () => primaryResolver,
    /** The primary translation's own numerals, when it carries a table. */
    digits: () => (primaryMeta?.digit?.length ? primaryMeta.digit : pack()?.digit ?? null),
    layouts: LAYOUTS,
    get activeTab() { return activeTab(); },
    get tabs() { return tabs.map((t) => ({ ...t })); },
  };
}
