/**
 * The phone shell: the same workspace, features and registry as the desktop,
 * presented the way a phone is used.
 *
 *   tab bar    five places, as a floating capsule: Read, Search, Library,
 *              Study, More. It follows the reading's scroll one to one and
 *              settles when the finger lifts.
 *   controls   over the reading, as separate pieces of glass: the
 *              translation, the passage, the text settings and the
 *              chapter's menu. They thin out while text passes under them.
 *   sheets     everything that is chosen or done arrives from the bottom:
 *              the book and chapter picker, the translations, a verse's
 *              actions, the chapter's menu. Set in from the edges; pulled
 *              down to put away.
 *   lists      Study and More are lists of what the build has — panes and
 *              documents from the registry — each opening full screen with
 *              a way back.
 *
 * Nothing here is a second implementation of a feature. A pane is opened in
 * a workspace tab (as "panes as tabs" does), a document the way it always
 * is, a verse's actions are the registry's. The workspace keeps its tabs;
 * the phone shows one at a time and has no tab strip, so History stands in
 * for the tabs a desktop reader would leave open.
 *
 * Active at phone width only (PHONE_WIDTH); `body[data-phone]` is what the
 * stylesheet goes by. A window made wider gets the desktop shell back.
 */

import { COLOURS } from '../core/annotations.js';
import { fill, h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

export const PHONE_WIDTH = 600;
const HISTORY_KEY = 'history';
const HISTORY_CAP = 30;
/** How far the tab bar travels to be out of sight. */
const TRAVEL = 96;
/** The strip at each side left to the system's own gestures, and how long a swipe may take. */
const EDGE = 24;
const SWIPE_MS = 600;

/** What the Study tab lists, in this order, of what the build has. */
// The Notes pane is the chapter's notes; the list of all of them is the
// document of the same name, which is the one a list should lead to.
const STUDY_PANES = ['marks', 'tags', 'plan', 'links', 'outline', 'project', 'study', 'reference'];
const STUDY_DOCS = ['notes-manager', 'memory', 'projects'];
const STUDY_FIRST = ['marks', 'notes-manager'];
/** What More leaves out: its own tabs, and pages that are about a keyboard. */
const NOT_IN_MORE = new Set(['library', 'shortcuts', ...STUDY_DOCS]);
/** Panes that come up over the reading as a sheet, when asked for by name. */
const SHEET_PANES = new Set(['study', 'reference', 'guide', 'notes', 'links', 'outline']);

export function createPhone(ctx, { chrome, workspace, readingPanel, verseBar }) {
  const { registry, state, records } = ctx;
  const body = document.body;
  const query = window.matchMedia(`(max-width: ${PHONE_WIDTH}px)`);
  const on = () => query.matches;

  /** 'study' | 'more' while one of the two lists is in front. */
  let list = null;
  /** Workspace tab id → the list it was opened from, for the way back. */
  const origin = new Map();

  // --- elements ---------------------------------------------------------------

  const nav = h('header', { class: 'ph-nav' });
  const rootTitle = h('h1', { class: 'ph-root-title' });
  // Navigation between places, not a tab widget: a landmark of plain buttons,
  // the one in front marked as the current page.
  const tabs = h('nav', { class: 'ph-tabs ph-glass', 'aria-label': L('mob.nav') });
  const screen = h('section', { class: 'ph-screen', hidden: true });
  const scrim = h('div', { class: 'ph-scrim', onclick: () => closeSheet() });
  const sheetTitle = h('h2', { id: 'ph-sheet-title' });
  const sheetBody = h('div', { class: 'ph-sheet-b' });
  // The handle is also a button: a sheet that has two heights can be raised
  // and lowered without a drag.
  const grab = h('button', { class: 'ph-grab', 'aria-label': L('mob.expand'), onclick: () => toggleDetent() });
  const sheetHead = h('div', { class: 'ph-sheet-h' },
    h('span'), sheetTitle,
    h('button', { class: 'ph-done', onclick: () => closeSheet() }, L('mob.done')));
  const sheet = h('section', { class: 'ph-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ph-sheet-title', tabindex: '-1' },
    grab, sheetHead, sheetBody);
  sheet.inert = true;
  body.append(nav, rootTitle, tabs, screen, scrim, sheet);

  const glass = (...children) => h('div', { class: 'ph-glass ph-group' }, ...children);
  const navButton = (label, content, onclick, extra = '') => h('button', {
    class: `ph-btn ${extra}`.trim(), 'aria-label': label, title: label, onclick,
  }, content);
  const row = ({ glyph, title, sub = '', value = '', lang = null, onclick, chevron = true, check = false }) => h('button', { class: 'ph-row', onclick },
    glyph ? h('span', { class: 'ph-row-ic' }, icon(glyph)) : null,
    h('span', { class: 'ph-row-t', lang }, title, sub ? h('small', {}, sub) : null),
    value ? h('span', { class: 'ph-row-v' }, value) : null,
    check ? h('span', { class: 'ph-row-check' }, icon('check')) : chevron ? h('span', { class: 'ph-row-chev' }, icon('chev')) : null);
  const group = (title, rows) => (rows.length ? [title ? h('div', { class: 'ph-group-h' }, title) : null, h('div', { class: 'ph-list' }, rows)] : []);

  // --- where the reader is ------------------------------------------------------

  const TABS = [
    { id: 'read', glyph: 'book-open', name: () => L('mob.read') },
    { id: 'search', glyph: 'search', name: () => L('mob.search') },
    { id: 'library', glyph: 'library', name: () => L('doc.library') },
    { id: 'study', glyph: 'note', name: () => L('mob.study') },
    { id: 'more', glyph: 'more', name: () => L('mob.more') },
  ];
  const hasPane = (id) => registry.panes().some((pane) => pane.id === id);

  /** Which tab is in front, from what the workspace is showing. */
  function view() {
    if (list) return list;
    const tab = workspace.activeTab;
    if (!tab || tab.kind === 'chapter') return 'read';
    if (tab.kind === 'pane:search') return 'search';
    if (tab.kind === 'library') return 'library';
    return origin.get(tab.id) ?? 'more';
  }

  /**
   * Tabs opened from Study or More are closed when the reader goes somewhere
   * else: a phone has no tab strip to close them from, and one left behind
   * would be where its pane opened from then on.
   */
  function closeListed() {
    for (const id of [...origin.keys()]) {
      origin.delete(id);
      if (workspace.tabs.some((tab) => tab.id === id)) workspace.closeTab(id);
    }
  }

  async function go(id) {
    closeSheet();
    closeListed();
    if (id === 'study' || id === 'more') { list = id; paint(); return; }
    list = null;
    if (id === 'read') {
      const chapter = [...workspace.tabs].reverse().find((tab) => tab.kind === 'chapter');
      if (chapter) workspace.activate(chapter.id);
      else await workspace.openChapter(state.get().book, state.get().chapter);
    } else if (id === 'search' && hasPane('search')) await workspace.openPaneTab('search');
    else if (id === 'library') await workspace.openDoc('library');
    paint();
  }

  /** Open something from a list, remembering the list for the way back. */
  async function openFrom(from, open) {
    list = null;
    await open();
    const tab = workspace.activeTab;
    if (tab && tab.kind !== 'chapter') origin.set(tab.id, from);
    paint();
  }

  /** A page with places of its own inside it (Settings' sections) takes Back first. */
  let backHook = null;

  function back() {
    if (backHook?.()) return;
    const tab = workspace.activeTab;
    const from = tab ? origin.get(tab.id) : null;
    if (tab && from) { origin.delete(tab.id); workspace.closeTab(tab.id); }
    list = from ?? 'more';
    paint();
  }

  // --- painting -------------------------------------------------------------------

  /** What was in front at the last paint: the view, the tab, the list. */
  let front = '';

  function paint() {
    const phone = on();
    if (phone) body.dataset.phone = 'on'; else delete body.dataset.phone;
    if (!phone) { closeSheet(); return; }
    const now = view();
    const tab = workspace.activeTab;
    const reading = now === 'read';
    // A pane over the reading is about the reading: once a link in it has
    // gone to another passage, or the reading is no longer in front, the
    // sheet would only be in the way of what was asked for.
    if (sheetPane && sheetOpen() && (!reading || passageKey() !== sheetAt)) closeSheet();
    const paged = !list && !reading && now !== 'search' && now !== 'library';
    body.dataset.phoneView = list ? 'list' : reading ? 'read' : paged ? 'page' : 'root';

    // Built once and updated in place: a control rebuilt under a finger, a
    // focus or a screen reader's cursor is a control taken away.
    if (!tabs.childElementCount) {
      fill(tabs, ...TABS.filter((t) => t.id !== 'search' || hasPane('search')).map((t) => h('button', {
        class: 'ph-tab', dataset: { tab: t.id }, 'aria-label': t.name(), title: t.name(), onclick: () => go(t.id),
      }, icon(t.glyph))));
    }
    for (const button of tabs.children) {
      if (button.dataset.tab === now) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }

    const doc = paged && tab
      ? (tab.kind.startsWith('pane:') ? registry.panes().find((pane) => pane.id === tab.kind.slice(5)) : registry.getDoc(tab.kind))
      : null;
    const { book, chapter } = state.get();
    const drawn = reading && tab ? `read|${workspace.primaryName()}|${workspace.bookName(book)}|${workspace.number(chapter)}|${workspace.lang()}`
      : doc ? `page|${doc.title}` : '';
    if (drawn !== nav.dataset.drawn) {
      nav.dataset.drawn = drawn;
      if (reading && tab) paintReadNav();
      else if (doc) {
        fill(nav,
          glass(navButton(L('mob.back'), icon('arrow-left'), back, 'ph-back')),
          h('div', { class: 'ph-glass ph-title' }, doc.title),
          h('span'));
      } else fill(nav);
    }
    // Search and Library have no controls over them: a large title instead.
    rootTitle.textContent = !list && !reading && !paged ? TABS.find((t) => t.id === now)?.name() ?? '' : '';

    screen.hidden = !list;
    if (list) paintList();
    // A page that has just come to the front starts with its controls in
    // place; one being scrolled keeps what the scroll made of them.
    const shown = `${body.dataset.phoneView}|${tab?.id ?? ''}|${list ?? ''}`;
    if (shown !== front) {
      front = shown;
      setOff(0);
      const at = (list ? screen : chrome.panes.querySelector(SCROLLERS))?.scrollTop ?? 0;
      // The bar moves by how far this page moves from here, not by where
      // the last page was left: what a page reports as it arrives (the
      // workspace putting it back where it was) is where it starts from.
      rebase = performance.now() + 400;
      lastY = at;
      mark(at);
    }
  }

  function paintReadNav() {
    const { book, chapter } = state.get();
    fill(nav,
      glass(navButton(L('cmd.translation'), h('span', { class: 'ph-pill' }, workspace.primaryName()), openTranslations, 'ph-tr')),
      h('button', {
        class: 'ph-glass ph-where', 'aria-haspopup': 'dialog', lang: workspace.lang(), onclick: openPicker,
        'aria-label': `${workspace.englishRef(book, chapter)} — ${L('mob.books')}`,
      }, h('span', {}, `${workspace.bookName(book)} ${workspace.number(chapter)}`), icon('chev')),
      glass(
        navButton(L('cmd.reading'), 'Aa', (event) => readingPanel.toggle(event.currentTarget), 'ph-aa'),
        navButton(L('mob.chapterMenu'), icon('more'), openChapterMenu, 'ph-menu')));
  }

  function paintList() {
    const from = list;
    const paneRow = (pane) => row({ glyph: pane.icon, title: pane.title, onclick: () => openFrom(from, () => workspace.openPaneTab(pane.id)) });
    const docRow = (doc) => row({ glyph: doc.icon ?? 'files', title: doc.title, onclick: () => openFrom(from, () => workspace.openDoc(doc.id)) });
    if (from === 'study') {
      const panes = STUDY_PANES.map((id) => registry.panes().find((pane) => pane.id === id)).filter(Boolean);
      const docs = STUDY_DOCS.map((id) => registry.getDoc(id)).filter(Boolean);
      fill(screen,
        h('h1', { class: 'ph-big' }, L('mob.study')),
        ...group('', [...panes.map((pane) => [pane.id, paneRow(pane)]), ...docs.map((doc) => [doc.id, docRow(doc)])]
          .sort(([a], [b]) => (STUDY_FIRST.includes(b) ? 1 : 0) - (STUDY_FIRST.includes(a) ? 1 : 0)).map(([, el]) => el)),
        ...group(L('mob.history'), historyRows(8)));
      return;
    }
    const guide = registry.panes().find((pane) => pane.id === 'guide');
    const docs = registry.docs().filter((doc) => !NOT_IN_MORE.has(doc.id));
    const first = ['settings', 'help', 'welcome', 'about'];
    const tools = docs.filter((doc) => !first.includes(doc.id));
    fill(screen,
      h('h1', { class: 'ph-big' }, L('mob.more')),
      ...group('', [guide ? paneRow(guide) : null, ...tools.map(docRow)].filter(Boolean)),
      ...group(L('app.name'), first.map((id) => registry.getDoc(id)).filter(Boolean).map(docRow)));
  }

  // --- history ----------------------------------------------------------------------

  const history = () => (Array.isArray(records.get(HISTORY_KEY, null)?.list) ? records.get(HISTORY_KEY, null).list : []);
  let lastSeen = '';
  let historyFailed = false;
  function remember() {
    const { book, chapter } = state.get();
    const key = `${book}.${chapter}`;
    if (key === lastSeen || workspace.activeTab?.kind !== 'chapter') return;
    lastSeen = key;
    const next = [{ book, chapter, at: Date.now() }, ...history().filter((item) => item.book !== book || item.chapter !== chapter)].slice(0, HISTORY_CAP);
    // Said once: a store that cannot be written to fails at every chapter.
    records.save(HISTORY_KEY, { list: next }).catch((err) => {
      if (!historyFailed) chrome.notify(err.message, 'error');
      historyFailed = true;
    });
  }
  function historyRows(limit) {
    const { book, chapter } = state.get();
    return history().filter((item) => item.book !== book || item.chapter !== chapter).slice(0, limit).map((item) => row({
      glyph: 'clock', title: `${workspace.bookName(item.book)} ${workspace.number(item.chapter)}`, lang: workspace.lang(),
      onclick: async () => { list = null; closeSheet(); await go('read'); await workspace.openChapter(item.book, item.chapter); paint(); },
    }));
  }

  // --- sheets -------------------------------------------------------------------------

  let detent = 'auto';
  let onClose = null;
  const sheetOpen = () => sheet.classList.contains('is-on');

  /**
   * @param {string} title
   * @param {(Node|null)[]} content
   * @param {{ tall?: boolean, closed?: () => void }} [options] `tall` opens at
   *        half height and can be pulled to the full screen
   */
  /** What is behind a sheet, taken out of reach while one is up. */
  const behind = () => [chrome.element, nav, rootTitle, tabs, screen];
  let opener = null;

  function setDetent(next) {
    detent = next;
    sheet.classList.toggle('is-full', next === 'full');
    sheet.style.height = next === 'auto' ? '' : next === 'full' ? '94%' : '56%';
    grab.hidden = false;
    grab.disabled = next === 'auto';
    grab.setAttribute('aria-label', L(next === 'full' ? 'mob.collapse' : 'mob.expand'));
    if (next === 'auto') grab.removeAttribute('aria-expanded'); else grab.setAttribute('aria-expanded', String(next === 'full'));
  }
  function toggleDetent() {
    if (detent === 'auto' || dragged) return;
    setDetent(detent === 'full' ? 'half' : 'full');
  }

  function openSheet(title, content, { tall = false, closed = null } = {}) {
    if (sheetOpen()) onClose?.();
    else opener = document.activeElement;
    onClose = closed;
    sheetTitle.textContent = title;
    fill(sheetBody, ...content);
    sheetBody.scrollTop = 0;
    setDetent(tall ? 'half' : 'auto');
    sheet.style.transform = '';
    sheet.inert = false;
    for (const el of behind()) el.inert = true;
    sheet.classList.add('is-on');
    scrim.classList.add('is-on');
    // Focus goes into the sheet, so a keyboard and a screen reader are in it
    // too; it goes back to what opened the sheet when it is put away.
    sheet.focus({ preventScroll: true });
    setOff(0);
  }
  function closeSheet() {
    if (!sheetOpen()) return;
    sheet.classList.remove('is-on');
    scrim.classList.remove('is-on');
    sheet.style.transform = '';
    sheet.inert = true;
    for (const el of behind()) el.inert = false;
    const done = onClose;
    onClose = null;
    done?.();
    const back = opener;
    opener = null;
    if (back?.isConnected && on()) back.focus({ preventScroll: true });
  }
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && sheetOpen()) { event.stopPropagation(); closeSheet(); } }, true);

  // Pulled down, a sheet is put away; a tall one pulls up to the full screen.
  let drag = null;
  /** A drag just ended on the handle: the click that follows it is not a press. */
  let dragged = false;
  for (const handle of [grab, sheetHead]) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.ph-done')) return;
      dragged = false;
      drag = { y: event.clientY, height: sheet.offsetHeight };
      sheet.classList.add('is-drag');
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dy = event.clientY - drag.y;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
      else if (detent !== 'auto') sheet.style.height = `${Math.min(drag.height - dy, window.innerHeight * 0.94)}px`;
    });
    const end = (event) => {
      if (!drag) return;
      const dy = event.clientY - drag.y;
      drag = null;
      dragged = Math.abs(dy) > 6;
      setTimeout(() => { dragged = false; }, 0);
      sheet.classList.remove('is-drag');
      sheet.style.transform = '';
      if (dy > 90) {
        if (detent === 'full') setDetent('half'); else closeSheet();
      } else if (dy < -50 && detent !== 'auto') {
        setDetent('full');
      } else if (detent !== 'auto') setDetent(detent);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Every book, the one being read open on its chapters. */
  function openPicker() {
    const here = state.get();
    let opened = here.book;
    const paintBooks = () => {
      const content = [];
      for (const testament of ctx.category.testaments) {
        content.push(h('div', { class: 'ph-group-h' }, workspace.testamentName(testament.id)));
        content.push(h('div', { class: 'ph-list' }, ctx.category.books.filter((b) => b.testament === testament.id).map((b) => {
          const has = workspace.hasBook(b.id);
          const open = opened === b.id;
          return h('div', { class: `ph-book${open ? ' is-open' : ''}${has ? '' : ' is-absent'}`, dataset: { book: b.id } },
            h('button', {
              class: 'ph-row', 'aria-expanded': String(open),
              onclick: () => { opened = open ? null : b.id; paintBooks(); sheetBody.querySelector('.ph-book.is-open')?.scrollIntoView({ block: 'nearest' }); },
            },
            h('span', { class: 'ph-row-t', lang: workspace.lang() }, workspace.bookName(b.id)),
            h('span', { class: 'ph-row-v' }, workspace.number(b.chapters))),
            open ? h('div', { class: 'ph-chapters' }, Array.from({ length: b.chapters }, (_, i) => h('button', {
              class: b.id === here.book && i + 1 === here.chapter ? 'is-here' : null,
              'aria-label': workspace.englishRef(b.id, i + 1),
              onclick: () => { closeSheet(); workspace.openChapter(b.id, i + 1); },
            }, workspace.number(i + 1)))) : null);
        })));
      }
      fill(sheetBody, ...content);
    };
    openSheet(L('mob.books'), [], { tall: true });
    paintBooks();
    sheetBody.querySelector('.ph-book.is-open')?.scrollIntoView({ block: 'start' });
  }

  async function openTranslations() {
    const installed = await ctx.store.list();
    const current = state.get().translation;
    const beside = workspace.panes().slice(1);
    const named = (id) => installed.find((t) => t.identify === id);
    const command = (id) => registry.commands().find((c) => c.id === id);
    const alongside = command('reading.add-pane');
    openSheet(L('cmd.translation'), [
      h('div', { class: 'ph-list' }, installed.map((t) => row({
        title: t.info.name, sub: [t.info.shortname, t.info.language?.text, t.info.year].filter(Boolean).join(' · '),
        lang: t.info.language?.name ?? null, check: t.identify === current, chevron: false,
        onclick: () => { closeSheet(); workspace.setPaneTranslation(0, t.identify); },
      }))),
      // Translations read alongside: under each verse of the first. A press takes one away.
      ...group(L('mob.alongside'), beside.map((id, i) => h('button', {
        class: 'ph-row', dataset: { beside: id }, 'aria-label': `${L('cmd.closeParallel')}: ${named(id)?.info.name ?? id}`,
        onclick: () => { closeSheet(); workspace.closePane(i + 1); },
      },
      h('span', { class: 'ph-row-t', lang: named(id)?.info.language?.name ?? null }, named(id)?.info.name ?? id),
      h('span', { class: 'ph-row-x' }, icon('x'))))),
      h('div', { class: 'ph-list' },
        alongside && installed.length > 1 ? row({ glyph: 'add-pane', title: L('mob.addAlongside'), onclick: () => { closeSheet(); alongside.run(); } }) : null,
        row({ glyph: 'library', title: L('lib.getMore'), onclick: () => go('library') })),
    ]);
  }

  /**
   * A study pane over the reading, as a sheet at half height: the word
   * study from a pressed word, the Reference pane, the Guide. The pane is the
   * one the desktop has, lent to the sheet for as long as it is up.
   */
  let sheetPane = null;
  let sheetAt = '';
  const passageKey = () => { const { book, chapter } = state.get(); return `${book}.${chapter}`; };
  function paneSheet(id) {
    if (!on() || view() !== 'read' || !SHEET_PANES.has(id)) return false;
    if (sheetPane === id && sheetOpen()) return true;
    // A tab of the same pane left from a list would keep the pane; it is closed.
    const left = workspace.tabs.find((tab) => tab.kind === `pane:${id}`);
    if (left) { origin.delete(left.id); workspace.closeTab(left.id); }
    const pane = registry.panes().find((p) => p.id === id);
    if (!pane) return false;
    const host = h('div', { class: 'ph-pane-host' });
    openSheet(pane.title, [host], {
      tall: true,
      closed: () => { sheetPane = null; sheet.classList.remove('has-pane'); unhost(); chrome.paneTabs.release(id); },
    });
    sheet.classList.add('has-pane');
    const unhost = chrome.paneTabs.host(id, host);
    sheetPane = id;
    sheetAt = passageKey();
    return true;
  }
  chrome.paneTabs.sheet(paneSheet);

  /** What can be done with the chapter: the commands this build has for it. */
  function openChapterMenu() {
    const { book, chapter } = state.get();
    const wanted = ['speech.toggle', 'reading.copy', 'composer.open', 'reading.add-pane', 'reading.translationInfo', 'reading.mode'];
    const commands = wanted.map((id) => registry.commands().find((c) => c.id === id)).filter(Boolean);
    openSheet(`${workspace.bookName(book)} ${workspace.number(chapter)}`, [
      h('div', { class: 'ph-list' }, commands.map((c) => row({
        glyph: c.icon ?? 'cmd', title: c.title, chevron: false, onclick: () => { closeSheet(); c.run(); },
      }))),
      ...group(L('mob.history'), historyRows(6)),
    ]);
  }

  /**
   * A verse's actions, as a sheet: the colours a verse can be marked in, and
   * every action a feature registered, each with its name.
   */
  function openVerse(passage) {
    const here = { ...passage, to: passage.to ?? null };
    const { annotations } = ctx;
    const span = here.to ? `${workspace.number(here.verse)}–${workspace.number(here.to)}` : workspace.number(here.verse);
    const tint = (shown) => {
      for (const el of chrome.panes.querySelectorAll('.leaf[data-pane="0"] .verse')) {
        const verse = Number(el.closest('.vblock')?.dataset.verse);
        el.classList.toggle('is-selected', shown && verse >= here.verse && verse <= (here.to ?? here.verse));
      }
    };
    const marked = annotations.isMarked(here.book, here.chapter, here.verse);
    const colourNow = annotations.chapterIndex(here.book, here.chapter).marks.get(here.verse)?.colour ?? null;
    const mark = async (colour) => {
      closeSheet();
      if (annotations.isMarked(here.book, here.chapter, here.verse)) await annotations.toggleMark(here.book, here.chapter, here.verse, null, here.to);
      if (colour) await annotations.toggleMark(here.book, here.chapter, here.verse, colour, here.to);
    };
    openSheet(`${workspace.bookName(here.book)} ${workspace.number(here.chapter)}:${span}`, [
      h('div', { class: 'ph-colours', role: 'group', 'aria-label': L('mob.highlight') },
        h('button', { class: 'ph-dot', 'aria-label': L('mob.noHighlight'), title: L('mob.noHighlight'), disabled: marked ? null : '', onclick: () => mark(null) }, icon('x')),
        ...COLOURS.map((colour) => h('button', {
          class: 'ph-dot', dataset: { colour }, 'aria-label': L(`mob.colour.${colour}`), title: L(`mob.colour.${colour}`),
          'aria-pressed': String(marked && colourNow === colour), onclick: () => mark(colour),
        }))),
      h('div', { class: 'ph-acts' }, registry.verseActions().map((action) => {
        const title = typeof action.title === 'function' ? action.title(here) : action.title;
        return h('button', {
          class: 'ph-act', dataset: { action: action.id },
          'aria-pressed': action.isOn ? String(Boolean(action.isOn(here))) : null,
          onclick: async () => { closeSheet(); await action.run(here); },
        }, icon(typeof action.icon === 'function' ? action.icon(here) : action.icon), h('span', {}, title));
      })),
    ], { closed: () => tint(false) });
    tint(true);
  }

  // --- the reading: the tab bar follows the scroll, a swipe turns the chapter -----------

  let off = 0;
  let lastY = 0;
  /** Until when a scroll is the page being put back, not the reader moving it. */
  let rebase = 0;
  let touching = false;
  let idle = null;
  function setOff(value, tracking = false) {
    off = Math.max(0, Math.min(TRAVEL, value));
    body.classList.toggle('ph-tracking', tracking);
    body.style.setProperty('--ph-off', String(off));
  }
  /** The finger has lifted and the page is still: all the way in, or all the way out. */
  const settle = () => { if (!touching) setOff(off > TRAVEL / 2 ? TRAVEL : 0); };
  // Every page is the whole screen's, not only the reading: whatever scrolls
  // a page (a chapter, a document, Study and More) runs under the controls,
  // and the tab bar gets out of its way going down and comes back going up.
  // A pane shown as a page (Search, the Guide, Bookmarks) scrolls in its body.
  const SCROLLERS = '.leaf-scroll, .leaf-pane > .pane-view > .pane-body, .ph-screen';
  const pageScroller = (target) => (target instanceof Element && target.matches(SCROLLERS) ? target : null);
  /** Past the top of a page by more than its own heading: what floats there is on its own. */
  const DEEP = 150;
  const mark = (y) => {
    body.classList.toggle('ph-scrolled', y > 8);
    body.classList.toggle('ph-deep', y > DEEP);
    body.style.setProperty('--ph-y', String(Math.max(0, Math.round(y))));
  };

  function onScroll(event) {
    if (!on()) return;
    const scroller = pageScroller(event.target);
    if (!scroller) return;
    const y = scroller.scrollTop;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (performance.now() < rebase) lastY = Math.max(0, Math.min(max, y));
    // How far the page has moved, for what moves away with it (a large
    // title) and what comes to float once it has (a search field).
    mark(y);
    // Past either end (the rubber band) is not reading on: the bar stays put.
    if (y >= 0 && y <= max) setOff(y < 12 ? 0 : off + (y - lastY), true);
    lastY = Math.max(0, Math.min(max, y));
    clearTimeout(idle);
    idle = setTimeout(settle, 140);
  }
  chrome.panes.addEventListener('scroll', onScroll, { capture: true, passive: true });
  screen.addEventListener('scroll', onScroll, { passive: true });
  for (const type of ['touchstart', 'touchend', 'touchcancel']) {
    screen.addEventListener(type, () => { touching = type === 'touchstart'; if (!touching) { clearTimeout(idle); idle = setTimeout(settle, 140); } }, { passive: true });
  }

  // A bar that has slid away is still reachable by keyboard and by a screen
  // reader; reaching it brings it back.
  tabs.addEventListener('focusin', () => setOff(0));

  // The on-screen keyboard covers the bottom of the page: a sheet stands on
  // top of it, not under it.
  const vv = window.visualViewport;
  if (vv) {
    const kb = () => body.style.setProperty('--ph-kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    vv.addEventListener('resize', kb);
    vv.addEventListener('scroll', kb);
    kb();
  }

  let swipe = null;
  chrome.panes.addEventListener('touchstart', (event) => {
    touching = true;
    const touch = event.touches[0];
    // The screen's edges belong to the system (its own back gesture), and a
    // row that scrolls sideways belongs to itself.
    const edge = touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE;
    const own = event.target instanceof Element && event.target.closest('.xrefs, .interlinear, table, pre, [data-noswipe]');
    swipe = event.touches.length === 1 && !edge && !own ? { x: touch.clientX, y: touch.clientY, at: event.timeStamp } : null;
  }, { passive: true });
  for (const type of ['touchend', 'touchcancel']) {
    chrome.panes.addEventListener(type, (event) => {
      touching = false;
      clearTimeout(idle);
      idle = setTimeout(settle, 140);
      const start = swipe;
      swipe = null;
      if (!start || type === 'touchcancel' || !on() || view() !== 'read' || window.getSelection()?.toString()) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // A swipe is quick and level; a slow drag is a selection or a second thought.
      if (event.timeStamp - start.at > SWIPE_MS) return;
      if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 2.2) return;
      // Forward is the way the text runs: a swipe to the left in English,
      // to the right in Hebrew.
      const forward = (workspace.primaryDirection?.() ?? 'ltr') === 'rtl' ? dx > 0 : dx < 0;
      workspace.step(forward ? 1 : -1);
    }, { passive: true });
  }
  // A press on the text itself, not on anything in it, shows or hides the bar.
  chrome.panes.addEventListener('click', (event) => {
    if (!on() || view() !== 'read' || window.getSelection()?.toString()) return;
    if (event.target.closest('button, a, summary, label, select, [role="button"], [role="link"], [tabindex], .strongs, .ilw, .xrefs, .note-mark, input, textarea, [contenteditable]')) return;
    if (!event.target.closest('.leaf[data-pane="0"] .note')) return;
    setOff(off > TRAVEL / 2 ? 0 : TRAVEL);
  });

  // --- keeping up ---------------------------------------------------------------------------

  // The workspace repaints its panes whenever what is in front changes; the
  // controls over it follow.
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; remember(); paint(); });
  };
  new MutationObserver(later).observe(chrome.panes, { childList: true });
  state.subscribe(later);
  query.addEventListener('change', () => { list = null; paint(); workspace.render(); });
  paint();

  return {
    /** Whether the phone shell is the one in front. */
    get on() { return on(); },
    paint,
    openVerse,
    openSheet,
    closeSheet,
    /** Bring a tab to the front by name, for the tour and the tests. */
    go,
    /** The tab bar brought back into view, for whatever is about to point at it. */
    showBar: () => setOff(0),
    /**
     * A page with places inside it takes the Back button first.
     * @param {(() => boolean)|null} fn  true when it went back itself
     */
    onBack(fn) { backHook = fn; },
    /** The verse bar is the desktop's; on a phone its job is a sheet's. */
    verseBar: { show: (anchor, passage, options) => (on() ? openVerse(passage) : verseBar.show(anchor, passage, options)) },
  };
}
