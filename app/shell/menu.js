/**
 * A small menu, anchored to the control that opened it.
 *
 * Not the command palette: that is for finding something by name among
 * everything the build offers. This is for choosing between a handful of
 * things that are already on screen — the panes a strip cannot show, the tabs
 * a strip cannot show — where a full-screen list would be a hammer.
 *
 * One menu exists for the whole shell; opening another closes the first.
 */

import { fill, h } from './dom.js';
import { icon } from './icons.js';

const element = h('div', { class: 'popover menu', role: 'menu', hidden: true });
let anchor = null;
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  document.body.append(element);
  document.addEventListener('pointerdown', (e) => {
    if (element.hidden || element.contains(e.target) || anchor?.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (!element.hidden && e.key === 'Escape') close(); });
  window.addEventListener('resize', () => close());
  window.addEventListener('wheel', () => close(), { passive: true });
}

export function close() {
  element.hidden = true;
  anchor?.setAttribute('aria-expanded', 'false');
  anchor = null;
}

/**
 * @param {HTMLElement} from the control the menu belongs to
 * @param {{ id?: string, title: string, icon?: string, active?: boolean,
 *           sub?: string, quiet?: boolean, tall?: boolean, run: () => void }[]} items
 *        `tall` puts `sub` under the name as a sentence, for a choice that
 *        needs saying what it does.
 *        `quiet` marks an item that is also reachable without this menu — the
 *        pane whose tab is on show — so the list can say which ones the menu
 *        is actually needed for without hiding the rest.
 */
export function openMenu(from, items) {
  wire();
  if (anchor === from && !element.hidden) { close(); return; }
  anchor = from;
  from.setAttribute('aria-expanded', 'true');
  fill(element, items.map((item) => h('button', {
    class: `menu-item${item.active ? ' is-active' : ''}${item.quiet ? ' is-quiet' : ''}${item.tall ? ' is-tall' : ''}`, role: 'menuitem',
    ...(item.id ? { dataset: { id: item.id } } : {}),
    onclick: () => { close(); item.run(); },
  },
    item.icon ? icon(item.icon) : null,
    h('span', { class: 'menu-name' }, item.title),
    item.sub ? h('span', { class: 'menu-sub' }, item.sub) : null)));
  element.hidden = false;
  place();
}

/** Under the control, or above it when there is no room below. */
function place() {
  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = element;
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight - 8 ? Math.max(rect.top - height - 6, 8) : below;
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}
