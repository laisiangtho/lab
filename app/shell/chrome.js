/**
 * Shell chrome: ribbon, sidebars, top band, status bar, toasts.
 *
 * The markup and class names are Phase 1's, so app/styles/shell.css applies
 * unchanged. What the shell shows comes from the registry: ribbon buttons and
 * the palette from commands, sidebar strips from panes, tabs from docs.
 */

import { applyStrings, L } from './i18n.js';
import { fill, h } from './dom.js';
import { createPaneDrag, wireResizer, wireRibbonDrag, wireRowDivider } from './dragdrop.js';
import { icon, mountIcons } from './icons.js';
import { openMenu } from './menu.js';
import { wireFades } from './fade.js';
import { fitStrip, watchStrip } from './overflow.js';
import { applyAccent, applyTheme, THEME_ICON, watchSystemTheme } from './theme.js';
import { MAX_ROWS } from '../core/settings.js';

/** The shortest a sidebar row may be dragged. */
const MIN_ROW_PX = 96;

/**
 * Below this width there is no room for a column beside the text, so a sidebar
 * arrives as a drawer over it. The stylesheet switches at the same number.
 */
const DRAWER_WIDTH = 900;

export function createChrome(root, ctx) {
  const { registry, settings, state } = ctx;

  mountIcons();
  const prefs = settings.get();
  applyTheme(prefs.theme);
  applyAccent(prefs.accent);
  watchSystemTheme(() => settings.get().theme);

  const ribRail = h('div', { class: 'rib-rail' });
  /** Strips already being watched for a change of height. */
  const ribbonWatched = new WeakSet();
  /** The document on show, for the buttons that open one. */
  let openDocId = null;
  /** Under the rail, never in it: the ribbon's own controls. */
  const ribMore = h('button', {
    class: 'rib rib-more', hidden: true, 'aria-haspopup': 'menu',
    title: L('cmd.ribbonMore'), 'aria-label': L('cmd.ribbonMore'),
    onclick: (e) => openRibbonOverflow(e.currentTarget),
  }, icon('more'));
  /**
   * Add a button — and, while one is being dragged, the bin that takes it off.
   * One place at the foot of the rail for both, because they are the same
   * question asked in two directions, and because a control that only appears
   * during a drag cannot be pressed by accident at any other time.
   */
  const ribAdd = h('button', {
    class: 'rib rib-add', title: L('cmd.ribbonAdd'), 'aria-label': L('cmd.ribbonAdd'),
    onclick: (e) => openRibbonAdd(e.currentTarget),
  }, icon('plus'), h('span', { class: 'rib-bin' }, icon('bin-open')));
  const ribFoot = h('div', { class: 'rib-foot' }, ribMore, ribAdd);
  const tabStrip = h('div', { class: 'tabstrip', id: 'tabStrip', role: 'tablist' });
  const panes = h('div', { class: 'panes', id: 'panes', role: 'tabpanel' });
  const statusLeft = h('div', { class: 'sb-group' });
  const statusRight = h('div', { class: 'sb-group' });
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });

  const sides = { left: buildSidebar('left'), right: buildSidebar('right') };

  const navPrev = barButton('chev', 'cmd.prev', 'flip');
  const navNext = barButton('chev', 'cmd.next');
  const addPane = barButton('add-pane', 'cmd.parallel', '', () => run('reading.add-pane'));
  addPane.id = 'btnSplit';
  for (const button of [navPrev, navNext, addPane]) button.dataset.needsChapter = '1';
  /**
   * The band's own actions. A command that acts on what is being read belongs
   * here rather than on the ribbon: the ribbon is a column of places to go, and
   * a button that is dead on every document tab does not belong in it.
   */
  const barActions = h('div', { class: 'tb-actions' });
  const toggles = {
    left: barButton('panel-l', 'side.left'),
    right: barButton('panel-r', 'side.right'),
  };

  // Shown only in the narrow layout, where the ribbon is not: the app's mark,
  // and the way back to the command palette.
  const barApp = h('button', { class: 'app-pill', id: 'barApp', 'data-l': 'cmd.palette', onclick: () => run('shell.palette') },
    h('span', { class: 'app-mark' }, h('img', { src: './icons/icon.svg', alt: '', width: 18, height: 18 })),
    h('span', {}, L('app.name')));

  const scrim = h('div', { class: 'scrim-mobile', onclick: () => closeDrawers() });
  const mobileBar = h('nav', { class: 'mobile-bar', role: 'toolbar' },
    mobileButton('library', 'side.left', () => toggleSide('left')),
    mobileButton('chev', 'cmd.prev', () => run('passage.prev-chapter'), 'flip'),
    mobileButton('chev', 'cmd.next', () => run('passage.next-chapter')),
    mobileButton('inspector', 'side.right', () => toggleSide('right')),
    mobileButton('more', 'cmd.palette', () => run('shell.palette')));

  const app = h('div', { id: 'app' },
    h('div', { class: 'body-row' },
      h('nav', { class: 'ribbon' },
        h('div', { class: 'rib-head band-drag' },
          h('button', { class: 'rib-app', 'data-l': 'app.name', onclick: () => run('shell.palette') },
            h('span', { class: 'app-mark' }, h('img', { src: './icons/icon.svg', alt: '', width: 20, height: 20 })))),
        ribRail,
        ribFoot),
      sides.left.element,
      h('main', { class: 'workspace' },
        h('div', { class: 'tabbar band-drag' },
          h('div', { class: 'nav-group' }, navPrev, navNext),
          barApp,
          tabStrip,
          barActions,
          h('span', { class: 'bar-sep' }),
          h('div', { class: 'win-ctl' }, toggles.left, toggles.right)),
        panes),
      sides.right.element),
    h('div', { class: 'statusbar' }, statusLeft, h('span', { class: 'spacer' }), statusRight),
    scrim,
    mobileBar,
    toasts);

  root.replaceChildren(app);
  applyWindowFrame();
  applyChrome(settings.get());

  navPrev.addEventListener('click', () => run('passage.prev-chapter'));
  navNext.addEventListener('click', () => run('passage.next-chapter'));
  for (const side of ['left', 'right']) {
    toggles[side].addEventListener('click', () => toggleSide(side));
  }

  function run(id) {
    const command = registry.commands().find((c) => c.id === id);
    if (command) command.run();
  }

  /**
   * A sidebar is a column of rows. Each row has its own tab strip and shows one
   * of its panes; the rows share the height in the proportions the reader set.
   *
   * Pane views are built and mounted once and parked in a holder when they are
   * not on show, so rearranging the sidebar never remounts a pane — a search
   * with results in it survives being dragged into another row.
   */
  function buildSidebar(side) {
    const body = h('div', { class: 'side-body' });
    const holder = h('div', { class: 'pane-holder' });
    const hint = h('div', { class: 'drop-hint', hidden: true });
    const caret = h('div', { class: 'drop-caret', hidden: true });
    const element = h('aside', { class: `sidebar ${side}`, id: `side-${side}` }, body, holder, hint, caret,
      h('div', { class: 'resizer', 'data-side': side }));

    /** @type {{ views: string[], active: string|null, size: number }[]} */
    let rows = [];
    const views = new Map(); // pane id → { pane, element }

    function build(list) {
      for (const pane of list) {
        // No title row: the pane's own tab already names it, and repeating the
        // name inside the pane costs a line of every column. The name is on the
        // tab as its accessible name, and on the view itself for anything that
        // reads the document rather than looks at it.
        const view = h('section', {
          class: 'pane-view', 'data-view': pane.id,
          role: 'tabpanel', 'aria-label': pane.title,
        }, h('div', { class: 'pane-body scroll' }));
        holder.append(view);
        views.set(pane.id, { pane, element: view });
      }
    }

    /** Strips already being watched for a change of width. */
    const watched = new WeakSet();

    /** Rebuild the rows from `rows`, moving the parked views into place. */
    function render() {
      for (const { element: view } of views.values()) holder.append(view);
      body.replaceChildren(...rows.flatMap((row, index) => {
        const strip = h('div', { class: `pane-tabs${index === 0 ? ' band-drag' : ''}`, role: 'tablist' });
        // More panes than the strip can hold is the ordinary case in a narrow
        // sidebar, so the ones that do not fit are reachable from a button
        // rather than simply gone.
        const more = h('button', {
          class: 'pane-more no-drag', hidden: true, 'aria-haspopup': 'menu',
          title: L('cmd.morePanes'), 'aria-label': L('cmd.morePanes'),
          onclick: (e) => openPaneMenu(e.currentTarget, index),
        }, icon('more'));
        strip.append(more);
        const group = h('div', { class: 'side-group', dataset: { side, group: String(index) }, style: { flexGrow: String(row.size), flexBasis: '0%' } }, strip);

        for (const id of row.views) {
          const entry = views.get(id);
          if (!entry) continue;
          const on = id === row.active;
          const tab = h('button', {
            class: `pane-tab${on ? ' is-active' : ''}`,
            'data-view': id, role: 'tab', 'aria-selected': String(on),
            title: entry.pane.title, 'aria-label': entry.pane.title,
          }, icon(entry.pane.icon));
          wireTab(tab, index, id);
          strip.insertBefore(tab, more);
          entry.element.classList.toggle('is-active', on);
          group.append(entry.element);
        }
        return index === 0 ? [group] : [rowDivider(index), group];
      }));
      wireFades(element);
      measureStrips();
    }

    /**
     * Which strips have more tabs than room. A strip cannot be measured until
     * it has been laid out, so this runs once now — for the common case where
     * the layout is already settled — and again on the next frame, and
     * thereafter whenever the strip's own width changes.
     */
    function measureStrips() {
      for (const strip of body.querySelectorAll('.pane-tabs')) measureStrip(strip);
      requestAnimationFrame(() => {
        for (const strip of body.querySelectorAll('.pane-tabs')) { measureStrip(strip); watch(strip); }
      });
    }

    /**
     * Fit the tabs to the room there is. The rules are in `overflow.js`, which
     * the workspace's own tab strip uses too — one behaviour, two strips.
     */
    function measureStrip(strip) {
      const more = strip.querySelector('.pane-more');
      if (!more) return;
      fitStrip(strip, { items: [...strip.querySelectorAll('.pane-tab')], more });
    }

    function watch(strip) {
      watchStrip(strip, () => measureStrip(strip), watched);
    }

    /**
     * The row's panes as a list. Every pane in the row is listed, not only the
     * ones that were hidden: a menu that changes its contents with the width of
     * the sidebar is a menu nobody can learn.
     */
    function openPaneMenu(anchor, index) {
      const row = rows[index];
      if (!row) return;
      const strip = anchor.closest('.pane-tabs');
      const hidden = new Set([...strip.querySelectorAll('.pane-tab[hidden]')].map((tab) => tab.dataset.view));
      openMenu(anchor, row.views.map((id) => {
        const entry = views.get(id);
        return entry && {
          id,
          title: entry.pane.title,
          icon: entry.pane.icon,
          active: id === row.active,
          quiet: !hidden.has(id),
          run: () => select(id),
        };
      }).filter(Boolean));
    }

    /** The divider between two rows: drag it to change how they share the height. */
    function rowDivider(index) {
      const divider = h('div', { class: 'row-divider', title: L('hint.resizeRows') });
      wireRowDivider(divider, {
        rows: () => [...body.querySelectorAll('.side-group')],
        index,
        min: MIN_ROW_PX,
        // Freeze every row at its measured height first, so the ones not being
        // dragged keep the height they had.
        onStart: (heights) => heights.forEach((px, i) => { rows[i].size = px || 1; }),
        onMove: (above, below) => { rows[index - 1].size = above; rows[index].size = below; },
        onEnd: persist,
      });
      return divider;
    }

    function wireTab(tab, index, id) {
      tab.addEventListener('click', () => select(id));
      dragPaneTab(tab, { side, group: index, view: id });
    }

    function select(id) {
      const row = rows.find((r) => r.views.includes(id));
      if (!row || row.active === id) return;
      row.active = id;
      render();
      persist();
    }

    function persist() {
      const key = side === 'left' ? 'sidebarLeft' : 'sidebarRight';
      ctx.state.set({ [key]: rows.map((r) => ({ views: [...r.views], active: r.active, size: r.size })) });
    }

    return {
      element, select, render, persist, measure: measureStrips,
      get rows() { return rows; },
      set rows(next) { rows = next; },
      has: (id) => views.has(id),
      adopt(id) {
        // A pane dragged in from the other sidebar brings its mounted view with it.
        const entry = sides[side === 'left' ? 'right' : 'left'].release(id);
        if (entry) views.set(id, entry);
        return Boolean(entry);
      },
      release(id) {
        const entry = views.get(id);
        if (entry) views.delete(id);
        return entry ?? null;
      },
      build,
      mount() {
        // A pane that cannot build itself says so inside its own body; the
        // other panes, and the text, are unaffected.
        for (const { pane, element: view } of views.values()) {
          const body = view.querySelector('.pane-body');
          try {
            pane.mount(body);
          } catch (err) {
            body.replaceChildren(h('div', { class: 'pane-broken' },
              h('p', {}, L('msg.paneBroken', { name: pane.title })),
              h('pre', {}, err.message)));
          }
        }
      },
      get empty() { return views.size === 0; },
      ids: () => rows.flatMap((r) => r.views),
    };
  }

  /**
   * The saved arrangement, checked against the panes this build actually has: a
   * pane the settings never heard of joins the first row of the side it
   * registered for, and an id no feature provides is dropped.
   */
  function arrange() {
    const saved = { left: settings.get().sidebarLeft, right: settings.get().sidebarRight };
    const placed = new Set([...saved.left, ...saved.right].flatMap((row) => row.views));
    for (const side of ['left', 'right']) {
      const known = new Set(registry.panes().map((p) => p.id));
      const rows = saved[side]
        .map((row) => ({ views: row.views.filter((id) => known.has(id)), active: row.active, size: row.size }))
        .filter((row) => row.views.length);
      const fresh = registry.panes(side).filter((p) => !placed.has(p.id)).map((p) => p.id);
      if (rows.length) rows[0].views.push(...fresh);
      else if (fresh.length) rows.push({ views: fresh, active: fresh[0], size: 1 });
      for (const row of rows) if (!row.views.includes(row.active)) row.active = row.views[0];
      sides[side].rows = rows;
      sides[side].build(rows.flatMap((row) => row.views).map((id) => registry.panes().find((p) => p.id === id)).filter(Boolean));
    }
  }

  /** Where a dragged pane tab would land, and what happens when it is dropped. */
  const dragPaneTab = createPaneDrag({
    host: (side) => sides[side].element,
    title: (id) => registry.panes().find((p) => p.id === id)?.title ?? id,
    iconOf: (id) => registry.panes().find((p) => p.id === id)?.icon ?? 'info',
    rows: (side) => sides[side].rows,
    maxRows: MAX_ROWS,
    onFull: () => notify(L('msg.limitRows', { n: MAX_ROWS }), 'error'),
    drop(view, target) {
      const from = ['left', 'right'].find((side) => sides[side].ids().includes(view));
      if (!from) return;
      if (from !== target.side) {
        sides[target.side].adopt(view);
        // A pane dropped into a sidebar that was empty opens that sidebar.
        const key = target.side === 'left' ? 'leftSidebar' : 'rightSidebar';
        if (!ctx.state.get()[key]) ctx.state.set({ [key]: true });
      }

      const source = sides[from].rows;
      const destination = sides[target.side].rows;
      const before = destination.length;
      const home = source.find((row) => row.views.includes(view));
      const at = home.views.indexOf(view);

      if (target.type === 'strip') {
        // Dropping into a sidebar that holds nothing yet gives it its first row.
        if (!destination.length) destination.push({ views: [], active: null, size: 1 });
        const row = destination[target.group] ?? destination[0];
        home.views = home.views.filter((id) => id !== view);
        let index = target.index;
        if (row === home && at > -1 && at < index) index--; // the removal shifts the gap
        row.views.splice(Math.max(0, Math.min(index, row.views.length)), 0, view);
        row.active = view;
      } else {
        home.views = home.views.filter((id) => id !== view);
        destination.splice(target.type === 'below' ? target.group + 1 : target.group, 0, { views: [view], active: view, size: 1 });
      }

      for (const side of new Set([from, target.side])) {
        const list = sides[side].rows;
        for (let i = list.length - 1; i >= 0; i--) {
          if (!list[i].views.length) list.splice(i, 1);
          else if (!list[i].views.includes(list[i].active)) list[i].active = list[i].views[0];
        }
        // Heights the reader set are discarded only when the row count changes.
        if (side === target.side && list.length !== before) for (const row of list) row.size = 1;
        sides[side].render();
        sides[side].persist();
      }
      applyChrome(ctx.state.get());
    },
  });

  /**
   * A window with no system title bar of its own puts the system's buttons over
   * this app's top band, and the band has to leave room for them: a strip at
   * the top on macOS, where the traffic lights sit, and the end of the row
   * elsewhere. A target with an ordinary title bar sets nothing and the layout
   * is untouched.
   */
  function applyWindowFrame() {
    const frame = ctx.platform.frame ?? null;
    if (frame === 'inset') document.body.dataset.platform = 'darwin';
    else if (frame === 'overlay') document.body.dataset.shell = 'on';
  }

  /** Chrome the reader can hide, and the widths they can drag. */
  function applyChrome(s) {
    const body = document.body;
    body.dataset.ribbon = s.ribbon ? 'on' : 'off';
    refreshRibbonState();
    body.dataset.status = s.statusBar ? 'on' : 'off';
    for (const side of ['left', 'right']) {
      const open = side === 'left' ? s.leftSidebar : s.rightSidebar;
      const empty = sides[side].empty;
      body.dataset[side] = open && !empty ? 'open' : 'shut';
      // A sidebar with nothing in it is out of the way, but it stays in the
      // document: while a pane is being dragged it shows a rail to drop onto,
      // or the last pane moved out of a sidebar could never be moved back.
      sides[side].element.dataset.empty = String(empty);
      sides[side].element.hidden = !open && !empty;
      toggles[side].setAttribute('aria-pressed', String(open && !empty));
      // A side with no panes in it has nothing to show, so its toggle does
      // nothing; saying so is better than a button that answers with silence.
      // It stays in place, because a pane can be dragged back into that side.
      toggles[side].disabled = empty;
      toggles[side].title = empty ? L(side === 'left' ? 'side.leftEmpty' : 'side.rightEmpty') : L(`side.${side}`);
      toggles[side].setAttribute('aria-label', toggles[side].title);
    }
    body.style.setProperty('--sidebar-l', `${s.leftWidth}px`);
    body.style.setProperty('--sidebar-r', `${s.rightWidth}px`);
    // A dragged sidebar edge is what decides whether the tabs still fit.
    for (const which of ['left', 'right']) sides[which].measure();
    // A drawer belongs to the narrow layout only; a window growing back to a
    // column layout must not leave one open over the text.
    if (!isDrawerLayout() && body.classList.contains('has-drawer')) closeDrawers();
    paintMobileBar();
  }

  /**
   * A sidebar as a drawer over the text — the same sheets, a different way in.
   * One drawer at a time, and the scrim closes whichever is open.
   */
  function isDrawerLayout() {
    return window.innerWidth <= DRAWER_WIDTH;
  }

  function closeDrawers() {
    document.body.classList.remove('drawer-l', 'drawer-r', 'has-drawer');
    paintMobileBar();
  }

  function toggleSide(side) {
    if (isDrawerLayout()) {
      const cls = side === 'left' ? 'drawer-l' : 'drawer-r';
      const open = document.body.classList.contains(cls);
      closeDrawers();
      if (!open && !sides[side].empty) {
        document.body.classList.add(cls, 'has-drawer');
      }
      paintMobileBar();
      return;
    }
    const key = side === 'left' ? 'leftSidebar' : 'rightSidebar';
    ctx.state.set({ [key]: !ctx.state.get()[key] });
  }

  function mobileButton(name, labelKey, onclick, extra = '') {
    return h('button', { class: extra, 'data-l': labelKey, 'data-mb': labelKey, onclick }, icon(name));
  }

  /** The bottom bar reports the same state the band does. */
  function paintMobileBar() {
    const body = document.body;
    const [left, , , right] = mobileBar.children;
    left.setAttribute('aria-pressed', String(body.classList.contains('drawer-l')));
    right.setAttribute('aria-pressed', String(body.classList.contains('drawer-r')));
    for (const button of mobileBar.querySelectorAll('[data-mb="cmd.prev"], [data-mb="cmd.next"]')) {
      button.disabled = body.dataset.tab !== 'chapter';
    }
    left.disabled = sides.left.empty;
    right.disabled = sides.right.empty;
  }

  function wireResizers() {
    for (const side of ['left', 'right']) {
      const handle = sides[side].element.querySelector('.resizer');
      const key = side === 'left' ? 'leftWidth' : 'rightWidth';
      const variable = side === 'left' ? '--sidebar-l' : '--sidebar-r';
      let live = ctx.state.get()[key];
      wireResizer(handle, {
        side,
        min: side === 'left' ? 180 : 200,
        max: side === 'left' ? 520 : 560,
        width: () => live,
        onMove: (px) => { live = px; document.body.style.setProperty(variable, `${px}px`); },
        onEnd: (px) => ctx.state.set({ [key]: px }),
      });
    }
  }

  function barButton(name, labelKey, extra = '', onclick, literal = false) {
    const attrs = { class: `tb-btn ${extra}`.trim(), onclick };
    // A registered command carries its own title; the fixed buttons name a
    // string key, so applyStrings can localise them where they stand.
    if (literal) Object.assign(attrs, { title: labelKey, 'aria-label': labelKey });
    else attrs['data-l'] = labelKey;
    return h('button', attrs, icon(name));
  }

  /**
   * Commands that only mean something with a chapter open are shown but not
   * pressable while a document tab is active, rather than failing when pressed.
   */
  function setChapterMode(on, kind = null) {
    document.body.dataset.tab = on ? 'chapter' : 'doc';
    openDocId = on ? null : kind;
    refreshRibbonState();
    paintMobileBar();
    for (const button of app.querySelectorAll('[data-needs-chapter]')) {
      button.disabled = !on;
      button.setAttribute('aria-disabled', String(!on));
    }
  }

  /**
   * The ribbon is the reader's, not the build's.
   *
   * What a feature asks for (`ribbon: true`) is only the starting arrangement.
   * Once the reader has moved a button, taken one out or put one in, the list
   * in settings is what is drawn — because which five commands belong on a rail
   * two centimetres wide is a question about how somebody works, and nobody
   * else can answer it. A stored id this build no longer has is dropped as it
   * is drawn, so a list outlives the features it was written against.
   *
   * The two at the top (go to, and the palette) and the two at the bottom
   * (help, theme) are fixed: they are how the reader reaches everything else,
   * including the way back from a ribbon they have emptied.
   */
  function defaultRibbon() {
    // The four the shell puts there itself, around whatever the features asked
    // for. They are part of the list rather than fixed furniture: a reader who
    // never uses the quick switcher should be able to take it off, and the way
    // to put anything back is under the rail, not inside it.
    const own = registry.commands().filter((c) => c.ribbon).map((c) => c.id);
    return [
      'shell.switcher', 'shell.palette',
      ...own,
      ...(registry.hasCommand('help.open') ? ['help.open'] : []),
      'shell.theme',
    ].filter((id) => registry.hasCommand(id));
  }

  function ribbonItems() {
    const stored = settings.get().ribbonItems;
    const wanted = stored ?? defaultRibbon();
    return wanted.map((id) => registry.commands().find((c) => c.id === id)).filter(Boolean);
  }

  function setRibbon(ids) {
    const same = ids.length === defaultRibbon().length && ids.every((id, i) => id === defaultRibbon()[i]);
    state.set({ ribbonItems: same ? null : ids });
    buildRibbon();
  }

  /** Commands that asked for a place in the band, between the fixed two. */
  function buildBarActions() {
    fill(barActions,
      addPane,
      ...registry.commands().filter((c) => c.bar).map((c) => {
        const button = barButton(c.icon ?? 'book', c.title, '', () => run(c.id), true);
        button.id = `bar-${c.id.replace(/\./g, '-')}`;
        if (c.needsChapter) button.dataset.needsChapter = '1';
        return button;
      }),
      barButton('more', 'cmd.palette', '', () => run('shell.palette')));
  }

  function buildRibbon() {
    fill(ribRail, ribbonItems().map((c) => {
      // The theme button shows which theme is running, so it is drawn from the
      // setting rather than from the command's own icon.
      const glyph = c.id === 'shell.theme' ? (THEME_ICON[settings.get().theme] ?? 'monitor') : (c.icon ?? 'book');
      const button = ribButton(glyph, c.title, null, true, c.id === 'shell.theme' ? 'themeBtn' : undefined);
      button.dataset.command = c.id;
      if (c.needsChapter) button.dataset.needsChapter = '1';
      button.addEventListener('contextmenu', (e) => { e.preventDefault(); openRibbonMenu(button, c.id); });
      return button;
    }));
    fitRibbon();
    watchStrip(ribRail, fitRibbon, ribbonWatched);
    setChapterMode(document.body.dataset.tab !== 'doc', openDocId);
  }

  /**
   * A button that says what is happening.
   *
   * A ribbon of identical glyphs tells the reader nothing about the state of
   * the app: whether ink is on, whether the Library is the tab in front of
   * them. A command therefore answers for itself — `state()` for something
   * that is on or off, `opens` for something that brings up a document — and
   * the button lights when it is the thing currently true.
   */
  function refreshRibbonState() {
    for (const button of ribRail.querySelectorAll('.rib[data-command]')) {
      const command = registry.commands().find((c) => c.id === button.dataset.command);
      if (!command) continue;
      let on = false;
      try {
        on = command.state ? Boolean(command.state()) : (command.opens ? command.opens === openDocId : false);
      } catch {
        // A feature that cannot answer is not a reason to lose the ribbon.
        on = false;
      }
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function fitRibbon() {
    fitStrip(ribRail, {
      axis: 'y',
      items: [...ribRail.querySelectorAll('.rib[data-command]')],
      more: ribMore,
    });
  }

  /** Off the ribbon, with the way back in the message. */
  function removeFromRibbon(id) {
    const gone = registry.commands().find((c) => c.id === id);
    const before = ribbonItems().map((c) => c.id);
    setRibbon(before.filter((x) => x !== id));
    notify(L('msg.ribbonRemoved', { name: gone?.title ?? id }), 'info', {
      action: { label: L('cmd.undo'), run: () => setRibbon(before) },
    });
  }

  /** What can be done to one button, from the button itself. */
  function openRibbonMenu(anchor, id) {
    openMenu(anchor, [
      { id: 'run', title: registry.commands().find((c) => c.id === id)?.title ?? id, icon: 'enter', run: () => run(id) },
      { id: 'remove', title: L('cmd.ribbonRemove'), icon: 'x', run: () => removeFromRibbon(id) },
      { id: 'add', title: L('cmd.ribbonAdd'), icon: 'plus', run: () => openRibbonAdd(anchor) },
      { id: 'reset', title: L('cmd.ribbonReset'), icon: 'undo', run: () => setRibbon(defaultRibbon()) },
    ]);
  }

  /**
   * The buttons the rail had no room for, and what can be done to the ribbon
   * as a whole. Every button is listed, the ones on the rail set back, so the
   * list does not change shape with the height of the window.
   */
  function openRibbonOverflow(anchor) {
    const hidden = new Set([...ribRail.querySelectorAll('.rib[hidden]')].map((el) => el.dataset.command));
    openMenu(anchor, [
      ...ribbonItems().map((c) => ({
        id: c.id, title: c.title, icon: c.icon ?? 'book',
        quiet: !hidden.has(c.id), run: () => run(c.id),
      })),
      { id: 'add', title: L('cmd.ribbonAdd'), icon: 'plus', run: () => openRibbonAdd(anchor) },
      { id: 'reset', title: L('cmd.ribbonReset'), icon: 'undo', run: () => setRibbon(defaultRibbon()) },
    ]);
  }

  /** Any command in the build, offered by name. */
  function openRibbonAdd() {
    const held = new Set(ribbonItems().map((c) => c.id));
    ctx.shell.pick({
      placeholder: L('ph.ribbonAdd'),
      items: registry.commands()
        .filter((c) => !held.has(c.id))
        .map((c) => ({ id: c.id, title: c.title, sub: c.keys?.replace('Mod', '⌘/Ctrl'), icon: c.icon ?? 'cmd' })),
      onPick: (item) => setRibbon([...held, item.id]),
    });
  }

  function ribButton(name, label, onclick, literal = false, id, extra = '') {
    const text = literal ? label : L(label);
    return h('button', { class: `rib${extra ? ` ${extra}` : ''}`, id, title: text, 'aria-label': text, onclick }, icon(name));
  }

  /**
   * A passing message. One that carries an action — "a new version is ready",
   * and the button that takes it — stays long enough to be read and acted on,
   * and can be dismissed by hand.
   * @param {{ action?: { label: string, run: () => void } }} [options]
   */
  function notify(message, kind = 'info', { action = null } = {}) {
    const cls = kind === 'error' ? 'toast err' : kind === 'ok' ? 'toast ok' : 'toast';
    const toast = h('div', { class: cls, role: kind === 'error' ? 'alert' : 'status' },
      icon(kind === 'error' ? 'alert' : 'info'), h('span', {}, message));
    if (action) {
      toast.append(
        h('button', { class: 'toast-act', onclick: () => { toast.remove(); action.run(); } }, action.label),
        h('button', { class: 'toast-x', title: L('cmd.close'), 'aria-label': L('cmd.close'), onclick: () => toast.remove() }, icon('x')));
    }
    toasts.append(toast);
    setTimeout(() => toast.remove(), action ? 30000 : kind === 'error' ? 9000 : 3500);
  }

  /** Status bar: left is context, right is state the reader can click. */
  function setStatus(left, right) {
    statusLeft.replaceChildren(...left);
    statusRight.replaceChildren(...right);
  }

  function refreshThemeIcon() {
    const button = app.querySelector('#themeBtn');
    if (button) button.replaceChildren(icon(THEME_ICON[settings.get().theme] ?? 'monitor'));
  }

  function start() {
    buildRibbon();
    buildBarActions();
    // A button is dragged up or down the rail to move it, and off the rail to
    // take it out; a press that never travels still runs the command.
    wireRibbonDrag(ribRail, {
      bin: ribAdd,
      commit(from, to) {
        const ids = ribbonItems().map((c) => c.id);
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        setRibbon(ids);
      },
      remove: (id) => removeFromRibbon(id),
      run: (id) => run(id),
    });
    arrange();
    for (const side of ['left', 'right']) {
      sides[side].render();
      sides[side].mount();
    }
    wireResizers();
    applyChrome(ctx.state.get());
    applyStrings(app);
    window.addEventListener('resize', () => applyChrome(ctx.state.get()));
  }

  return {
    element: app, tabStrip, panes, start, notify, setStatus, refreshThemeIcon, toggleSide, applyChrome, setChapterMode,
    closeDrawers, isDrawerLayout,
    /**
     * Ask every ribbon button what it is doing now.
     *
     * A button reports its own state through `state()`, but nothing polls: the
     * ribbon is repainted when the reader navigates. A feature whose state
     * changes on its own — reading aloud starting and stopping — has to say so,
     * or the button is right only by coincidence.
     */
    refreshCommands: () => refreshRibbonState(),
    /** The ribbon, for the settings page: what is on it, and how to change it. */
    ribbon: {
      items: () => ribbonItems(),
      defaults: () => defaultRibbon(),
      set: (ids) => setRibbon(ids),
      add: (anchor) => openRibbonAdd(anchor),
      isCustom: () => settings.get().ribbonItems !== null,
    },
    selectPane: (side, id) => {
      // A pane the reader moved to the other sidebar is selected where it is.
      const where = sides[side].has(id) ? side : side === 'left' ? 'right' : 'left';
      sides[where].select(id);
    },
  };
}
