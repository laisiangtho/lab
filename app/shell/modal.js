/**
 * The one modal: quick switcher, command palette and the pickers all use it.
 * Fuzzy match, arrow keys, Enter, Escape — Phase 1's behaviour and markup.
 *
 * For a screen reader it is a combobox: the field owns the list
 * (aria-controls), says which option the arrow keys are on
 * (aria-activedescendant, with aria-selected on that option), and is labelled
 * by what it asks for. Closing it puts the focus back where it was.
 */

import { h } from './dom.js';
import { L } from './i18n.js';
import { icon } from './icons.js';

let made = 0;

export function createModal() {
  const listId = `modal-list-${made += 1}`;
  const input = h('input', {
    class: 'modal-input', type: 'text', spellcheck: 'false',
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': listId,
  });
  const list = h('div', { class: 'modal-list', role: 'listbox', id: listId });
  const foot = h('div', { class: 'modal-foot', 'aria-hidden': 'true' },
    h('span', {}, h('span', { class: 'kbd' }, '↑↓'), L('modal.navigate')),
    h('span', {}, h('span', { class: 'kbd' }, '↵'), L('modal.open')),
    h('span', {}, h('span', { class: 'kbd' }, 'esc'), L('modal.dismiss')));
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, input, list, foot);
  const element = h('div', { class: 'scrim', hidden: true, onclick: (e) => { if (e.target === element) close(); } }, box);

  let items = [];
  let shown = [];
  let selected = 0;
  let onPick = null;
  /** Items worked out from what was typed, offered above the fixed list. */
  let suggest = null;
  /** Where the focus was before the modal took it. */
  let returnTo = null;

  function open(options) {
    if (element.hidden) returnTo = document.activeElement;
    items = options.items;
    onPick = options.onPick;
    suggest = options.suggest ?? null;
    input.placeholder = options.placeholder ?? '';
    input.setAttribute('aria-label', options.placeholder || L('modal.label'));
    input.value = options.query ?? '';
    selected = 0;
    element.hidden = false;
    paint();
    input.focus();
    input.select();
  }

  function close() {
    if (element.hidden) return;
    element.hidden = true;
    items = [];
    onPick = null;
    input.removeAttribute('aria-activedescendant');
    // Back to where the reader was, if that is still on the page; a command
    // run from the modal may move the focus on from there.
    const back = returnTo;
    returnTo = null;
    if (back?.isConnected && back !== document.body && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  function paint() {
    // What the query itself asks for comes first — a reference somebody typed
    // is a better answer than the closest command with the same letters.
    const offered = suggest?.(input.value) ?? [];
    shown = [...offered, ...filter(items, input.value).slice(0, 200)];
    selected = Math.min(selected, Math.max(shown.length - 1, 0));
    list.replaceChildren(...shown.map((item, i) => h('div', {
      class: `mi${i === selected ? ' is-sel' : ''}`, role: 'option', id: `${listId}-${i}`,
      'aria-selected': i === selected ? 'true' : 'false',
      dataset: { index: i, ...(typeof item.id === 'string' ? { id: item.id } : {}) },
      onclick: () => pick(item),
    },
      icon(item.icon ?? 'book'),
      h('div', { class: 'mi-main' },
        h('div', { class: 'mi-t' }, item.title),
        item.sub ? h('div', { class: 'mi-s' }, item.sub) : null),
      item.keys ? h('span', { class: 'kbd' }, item.keys) : null)));
    if (shown.length) input.setAttribute('aria-activedescendant', `${listId}-${selected}`);
    else input.removeAttribute('aria-activedescendant');
    list.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }

  function pick(item) {
    const handler = onPick;
    close();
    handler?.(item);
  }

  input.addEventListener('input', () => { selected = 0; paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { selected = Math.min(selected + 1, shown.length - 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { selected = Math.max(selected - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[selected]) { pick(shown[selected]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });

  /** Put a line in the box and act as though it were typed. */
  function setQuery(text) {
    input.value = text;
    selected = 0;
    paint();
    input.focus();
    // The caret goes to the end: the line is a start, not a suggestion to
    // replace, and the reader is about to keep typing.
    input.setSelectionRange(text.length, text.length);
  }

  /** Ask the suggestions again — something they depend on has arrived. */
  const refresh = () => { if (!element.hidden) paint(); };

  return { element, open, close, setQuery, refresh, get isOpen() { return !element.hidden; } };
}

/**
 * Subsequence match on title + sub, ranked by how tightly the query fits.
 *
 * Ties go to the title that is exactly what was typed, then to the shorter
 * title — the one with less in it that nobody asked for. Registration order
 * used to decide them, which put "Export settings" above "Settings" wherever a
 * language starts both titles with the same word, as Burmese does.
 */
export function filter(items, query) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored = [];
  for (const item of items) {
    const title = String(item.title).toLowerCase();
    const score = fuzzy(`${title} ${item.sub ?? ''}`.toLowerCase(), q);
    if (score !== null) scored.push({ item, score, exact: title.trim() === q, length: title.length });
  }
  return scored
    .sort((a, b) => (b.exact - a.exact) || (a.score - b.score) || (a.length - b.length))
    .map((s) => s.item);
}

function fuzzy(text, query) {
  let index = -1;
  let score = 0;
  let previous = -1;
  for (const ch of query) {
    index = text.indexOf(ch, index + 1);
    if (index === -1) return null;
    score += previous === -1 ? index : index - previous - 1;
    previous = index;
  }
  return score;
}
