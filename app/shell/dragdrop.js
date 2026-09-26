/**
 * Dragging in the shell: workspace tabs, sidebar pane tabs, sidebar widths and
 * the dividers between sidebar rows.
 *
 * Pointer events throughout — one code path for mouse, pen and touch. Two rules
 * hold every drag together:
 *
 * 1. `pointermove` and `pointerup` are listened for on the window, not on the
 *    element being dragged, and both come off in one place. A drag then
 *    survives the pointer leaving the element, and nothing is left behind when
 *    it ends — the class, the ghost and the drop marks always come off.
 * 2. Nothing is re-rendered while a drag is running. The model changes once, on
 *    release. Re-rendering mid-drag destroys the element under the pointer,
 *    which ends the drag silently and leaves its marks on screen.
 */

const DETACH_BELOW = 52;  // px below the tab strip before a tab is pulled out
const TRAVEL = 4;         // px before a press becomes a drag rather than a click

/**
 * Workspace tabs: reorder by dragging along the strip, or pull one down out of
 * the strip to detach it. A press that never travels is an activation, so
 * dragging never costs the reader a click.
 *
 * @param {HTMLElement} strip
 * @param {{ commit(from: number, to: number): void, detach(id: string, rect: DOMRect): void,
 *           activate(id: string): void, hint: { show(x: number, y: number): void, hide(): void } }} api
 */
export function wireTabDrag(strip, api) {
  strip.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.tab');
    if (!node || e.button !== 0 || e.target.closest('.t-close')) return;

    const tabs = [...strip.querySelectorAll('.tab')];
    const from = tabs.indexOf(node);
    if (from < 0) return;
    e.preventDefault(); // a drag must not select the text it passes over

    const rects = tabs.map((t) => t.getBoundingClientRect());
    const width = rects[from].width;
    const stripRect = strip.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const id = node.dataset.tab;
    let moved = false;
    let detaching = false;
    let to = from;

    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const away = ev.clientY > stripRect.bottom + DETACH_BELOW;
      if (away !== detaching) {
        detaching = away;
        node.classList.toggle('is-detaching', away);
        for (const t of tabs) if (t !== node) t.style.transform = '';
      }

      if (detaching) {
        moved = true;
        node.style.transform = `translate(${dx}px, ${ev.clientY - start.y}px)`;
        api.hint.show(ev.clientX, ev.clientY);
        return;
      }
      api.hint.hide();

      if (!moved) {
        if (Math.abs(dx) < TRAVEL) return;
        moved = true;
        node.classList.add('is-dragging');
        document.body.classList.add('is-dragging-ui');
      }
      node.style.transform = `translateX(${dx}px)`;

      // Where the dragged tab's centre now sits decides the landing index; the
      // others slide by exactly one tab width to open the gap.
      const centre = rects[from].left + width / 2 + dx;
      let next = from;
      rects.forEach((rect, i) => {
        if (i === from) return;
        const past = centre - (rect.left + rect.width / 2);
        if (i > from && past > 0) next = Math.max(next, i);
        if (i < from && past < 0) next = Math.min(next, i);
      });
      if (next === to) return;
      to = next;
      tabs.forEach((t, i) => {
        if (i === from) return;
        let shift = 0;
        if (to > from && i > from && i <= to) shift = -width;
        if (to < from && i >= to && i < from) shift = width;
        t.style.transform = shift ? `translateX(${shift}px)` : '';
      });
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      api.hint.hide();
      document.body.classList.remove('is-dragging-ui');
      node.classList.remove('is-dragging', 'is-detaching');
      for (const t of tabs) t.style.transform = '';

      if (detaching) { api.detach(id, rects[from]); return; }
      if (!moved) { api.activate(id); return; }
      if (to !== from) api.commit(from, to);
      else api.activate(id);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/**
 * Sidebar pane tabs. Every pixel of a sidebar resolves to a drop: a tab strip
 * means "join this row here", the upper or lower half of a row's body means
 * "make a new row there". Either sidebar may be the target, so a pane can cross
 * the workspace in one gesture.
 *
 * @param {{ host(side: 'left'|'right'): HTMLElement, title(view: string): string,
 *           iconOf(view: string): string, rows(side: 'left'|'right'): object[],
 *           maxRows: number, onFull(): void,
 *           drop(view: string, target: { side: string, type: string, group: number, index?: number }): void }} api
 * @returns {(tab: HTMLElement, where: { side: 'left'|'right', group: number, view: string }) => void}
 */
export function createPaneDrag(api) {
  const SIDES = ['left', 'right'];

  /** @returns {null | { side: string, type: 'strip'|'above'|'below', group: number, index?: number }} */
  function targetAt(x, y) {
    for (const side of SIDES) {
      const host = api.host(side);
      if (!host || host.hidden) continue;
      const box = host.getBoundingClientRect();
      if (x < box.left - 40 || x > box.right + 40 || y < box.top - 24 || y > box.bottom + 24) continue;

      const groups = [...host.querySelectorAll('.side-group')];
      if (!groups.length) return { side, type: 'strip', group: 0, index: 0 };

      // A strip wins wherever the pointer is near it, with a magnetic margin so
      // the reader does not have to be exact.
      for (const [i, group] of groups.entries()) {
        const strip = group.querySelector('.pane-tabs').getBoundingClientRect();
        if (y < strip.top - 8 || y > strip.bottom + 8) continue;
        const tabs = [...group.querySelectorAll('.pane-tab')];
        let index = tabs.length;
        for (const [k, other] of tabs.entries()) {
          const rect = other.getBoundingClientRect();
          if (x < rect.left + rect.width / 2) { index = k; break; }
        }
        return { side, type: 'strip', group: i, index };
      }

      for (const [i, group] of groups.entries()) {
        const rect = group.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) continue;
        const strip = group.querySelector('.pane-tabs').getBoundingClientRect();
        const top = strip.bottom;
        const height = Math.max(1, rect.bottom - top);
        return { side, type: (y - top) / height < 0.5 ? 'above' : 'below', group: i };
      }
      return { side, type: 'below', group: groups.length - 1 };
    }
    return null;
  }

  function clearPaint(host) {
    if (!host) return;
    const hint = host.querySelector('.drop-hint');
    const caret = host.querySelector('.drop-caret');
    if (hint) hint.hidden = true;
    if (caret) caret.hidden = true;
    for (const t of host.querySelectorAll('.pane-tab')) t.style.transform = '';
  }

  function paint(host, target, view) {
    const group = host.querySelectorAll('.side-group')[target.group];
    if (!group) return;
    const hostRect = host.getBoundingClientRect();
    const hint = host.querySelector('.drop-hint');
    const caret = host.querySelector('.drop-caret');

    if (target.type === 'strip') {
      const strip = group.querySelector('.pane-tabs');
      const tabs = [...strip.querySelectorAll('.pane-tab')];
      const stripRect = strip.getBoundingClientRect();
      let x;
      if (!tabs.length) x = stripRect.left + 14;
      else if (target.index >= tabs.length) x = tabs.at(-1).getBoundingClientRect().right + 2;
      else x = tabs[target.index].getBoundingClientRect().left - 2;
      caret.hidden = false;
      caret.style.left = `${x - hostRect.left}px`;
      caret.style.top = `${stripRect.bottom - hostRect.top - 24}px`;
      caret.style.height = '22px';
      // The neighbours open the gap the tab would land in.
      tabs.forEach((t, k) => {
        if (t.dataset.view === view) return;
        t.style.transform = `translateX(${k >= target.index ? 5 : -5}px)`;
      });
      return;
    }

    const groupRect = group.getBoundingClientRect();
    const stripRect = group.querySelector('.pane-tabs').getBoundingClientRect();
    const middle = (stripRect.bottom + groupRect.bottom) / 2;
    const top = target.type === 'above' ? stripRect.bottom : middle;
    const bottom = target.type === 'above' ? middle : groupRect.bottom;
    hint.hidden = false;
    hint.className = `drop-hint ${target.type}`;
    hint.style.left = `${groupRect.left - hostRect.left + 4}px`;
    hint.style.width = `${Math.max(0, groupRect.width - 8)}px`;
    hint.style.top = `${top - hostRect.top}px`;
    hint.style.height = `${Math.max(8, bottom - top)}px`;
  }

  function makeGhost(iconName, label) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${iconName}`);
    svg.append(use);
    const text = document.createElement('span');
    text.textContent = label;
    ghost.append(svg, text);
    document.body.append(ghost);
    return ghost;
  }

  return function wire(tab, { view }) {
    tab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      let ghost = null;
      let target = null;

      const move = (ev) => {
        if (!moved) {
          if (Math.abs(ev.clientX - start.x) < TRAVEL && Math.abs(ev.clientY - start.y) < TRAVEL) return;
          moved = true;
          tab.classList.add('is-ghost');
          document.body.classList.add('is-dragging-tab');
          ghost = makeGhost(api.iconOf(view), api.title(view));
        }
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        target = targetAt(ev.clientX, ev.clientY);
        for (const s of SIDES) clearPaint(api.host(s));
        if (target) paint(api.host(target.side), target, view);
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        ghost?.remove();
        document.body.classList.remove('is-dragging-tab');
        for (const s of SIDES) clearPaint(api.host(s));
        if (!moved || !target) { tab.classList.remove('is-ghost'); return; }
        // The class stays on until the click that follows this release has been
        // swallowed, or the drop would also count as a click on the tab.
        setTimeout(() => tab.classList.remove('is-ghost'), 0);
        if (target.type !== 'strip' && api.rows(target.side).length >= api.maxRows) { api.onFull(); return; }
        api.drop(view, target);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    tab.addEventListener('click', (e) => {
      if (tab.classList.contains('is-ghost')) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  };
}

/**
 * Sidebar resizing. The width is reported as it changes and once at the end, so
 * the caller can paint continuously but persist only the final value.
 * @param {HTMLElement} handle
 * @param {{ side: 'left'|'right', min: number, max: number,
 *           width(): number, onMove(px: number): void, onEnd(px: number): void }} api
 */
export function wireResizer(handle, api) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = api.width();
    handle.classList.add('dragging');
    document.body.classList.add('is-dragging-ui');

    const move = (ev) => {
      const delta = api.side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      api.onMove(Math.min(Math.max(startWidth + delta, api.min), api.max));
    };
    const up = () => {
      handle.classList.remove('dragging');
      document.body.classList.remove('is-dragging-ui');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      api.onEnd(api.width());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/**
 * The divider between two sidebar rows. Every row is frozen at its measured
 * height when the drag starts, so the rows that are not being dragged keep the
 * height they had; the two either side of the divider then trade pixels.
 *
 * @param {HTMLElement} divider
 * @param {{ rows(): HTMLElement[], index: number, min: number,
 *           onStart(heights: number[]): void, onMove(above: number, below: number): void,
 *           onEnd(): void }} api
 */
export function wireRowDivider(divider, api) {
  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const groups = api.rows();
    const above = groups[api.index - 1];
    const below = groups[api.index];
    if (!above || !below) return;

    api.onStart(groups.map((g) => g.offsetHeight));
    const startY = e.clientY;
    const heights = { above: above.offsetHeight, below: below.offsetHeight };
    divider.classList.add('dragging');
    document.body.classList.add('is-dragging-ui');

    const move = (ev) => {
      const delta = Math.max(api.min - heights.above, Math.min(heights.below - api.min, ev.clientY - startY));
      above.style.flexGrow = String(heights.above + delta);
      below.style.flexGrow = String(heights.below - delta);
      api.onMove(heights.above + delta, heights.below - delta);
    };
    const up = () => {
      divider.classList.remove('dragging');
      document.body.classList.remove('is-dragging-ui');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      api.onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

/**
 * Reorder parallel panes by dragging a leaf head sideways.
 * @param {HTMLElement} panes
 * @param {{ move(from: number, to: number): void }} api
 */
export function wirePaneDrag(panes, api) {
  panes.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.leaf-head');
    if (!head || e.target.closest('button') || e.button !== 0) return;
    const leaf = head.closest('.leaf');
    const from = Number(leaf.dataset.pane);
    if (Number.isNaN(from)) return;
    e.preventDefault();

    const startX = e.clientX;
    let dragging = false;

    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startX) < 6) return;
      if (!dragging) {
        dragging = true;
        leaf.classList.add('is-dragging');
        document.body.classList.add('is-dragging-ui');
      }
      const target = [...panes.querySelectorAll('.leaf')].find((other) => {
        if (other === leaf) return false;
        const rect = other.getBoundingClientRect();
        return ev.clientX > rect.left && ev.clientX < rect.right;
      });
      if (!target) return;
      const to = Number(target.dataset.pane);
      finish();
      api.move(from, to);
    };

    const finish = () => {
      leaf.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-ui');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

/**
 * The ribbon: drag a button up or down the rail to move it, or onto the bin
 * under the rail to take it off.
 *
 * Removal used to be a small × on the button, revealed by hovering it. That is
 * a trap: the ribbon is a column of 30 px buttons pressed dozens of times a
 * day, and the one control that destroys part of it sat a few pixels from the
 * one that runs it. So there is nothing to hit by accident any more. The add
 * button at the foot becomes a bin while a drag is running — the only time it
 * could mean anything — and a button is removed only by being carried to it and
 * let go. Anywhere else, the drag is a move, or nothing at all.
 *
 * @param {HTMLElement} rail
 * @param {{ commit(from: number, to: number): void, remove(id: string): void,
 *           run(id: string): void, bin: HTMLElement }} api
 */
export function wireRibbonDrag(rail, api) {
  rail.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.rib[data-command]');
    if (!node || e.button !== 0) return;

    const buttons = [...rail.querySelectorAll('.rib[data-command]')].filter((b) => !b.hidden);
    const from = buttons.indexOf(node);
    if (from < 0) return;
    e.preventDefault();

    const rects = buttons.map((b) => b.getBoundingClientRect());
    const height = rects[from].height;
    const railRect = rail.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    const id = node.dataset.command;
    let moved = false;
    let overBin = false;
    let to = from;

    /** Is the pointer on the bin? Measured live: the foot does not move. */
    const onBin = (ev) => {
      const box = api.bin.getBoundingClientRect();
      return ev.clientX >= box.left - 10 && ev.clientX <= box.right + 10
        && ev.clientY >= box.top - 10 && ev.clientY <= box.bottom + 10;
    };

    const move = (ev) => {
      const dy = ev.clientY - start.y;
      if (Math.abs(dy) > TRAVEL || Math.abs(ev.clientX - start.x) > TRAVEL) moved = true;
      if (!moved) return;
      if (!rail.dataset.dragging) rail.dataset.dragging = '1';

      const bin = onBin(ev);
      if (bin !== overBin) {
        overBin = bin;
        api.bin.classList.toggle('is-target', bin);
        node.classList.toggle('is-leaving', bin);
      }

      node.style.transform = `translate(${ev.clientX - start.x}px, ${dy}px)`;
      if (overBin) {
        for (const b of buttons) if (b !== node) b.style.transform = "";
        return;
      }
      // Where it would land: the others slide by exactly one button.
      const centre = rects[from].top + rects[from].height / 2 + dy;
      to = rects.findIndex((r, i) => (i === rects.length - 1 ? true : centre < r.bottom));
      if (to < 0) to = rects.length - 1;
      for (const [i, b] of buttons.entries()) {
        if (b === node) continue;
        const shift = (i > from && i <= to) ? -height : (i < from && i >= to) ? height : 0;
        b.style.transform = shift ? `translateY(${shift}px)` : "";
      }
    };

    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      for (const b of buttons) b.style.transform = "";
      node.classList.remove('is-leaving');
      api.bin.classList.remove('is-target');
      delete rail.dataset.dragging;
      if (!moved) { api.run(id); return; }
      if (onBin(ev)) { api.remove(id); return; }
      // Carried off the rail but not to the bin: a slip, not an instruction.
      if (to !== from) api.commit(from, to);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
