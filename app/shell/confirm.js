/**
 * Ask before something cannot be undone.
 *
 * The browser's own `confirm()` blocks the whole page, cannot be styled, and on
 * the desktop build opens a window over the app — the same objections that made
 * the colour picker the app's own. This one is a small dialog in the app: it names
 * what will happen, offers the cancel first, and resolves to a boolean.
 *
 * Escape and the backdrop both mean no, because the safe answer must be the
 * easy one.
 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';

export function createConfirm() {
  let settle = null;

  const heading = h('h2', { class: 'cf-h' });
  const body = h('p', { class: 'cf-p' });
  const no = h('button', { class: 'btn', onclick: () => answer(false) }, L('cmd.cancel'));
  const yes = h('button', { class: 'btn', onclick: () => answer(true) });
  const mark = h('span', { class: 'cf-mark' }, icon('alert'));

  const box = h('div', { class: 'modal confirm', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'cf-body' }, mark, h('div', { class: 'cf-text' }, heading, body)),
    h('div', { class: 'cf-acts' }, no, yes));
  const element = h('div', {
    class: 'scrim', hidden: true,
    onclick: (e) => { if (e.target === element) answer(false); },
  }, box);

  // Escape only. Enter used to answer *yes* wherever the focus was, which
  // quietly undid the safeguard three lines below: the dialog opens with the
  // cancel button focused so that a reader who presses Enter out of habit has
  // destroyed nothing — and then Enter destroyed it anyway, from a handler that
  // also suppressed the cancel button's own activation. Both buttons are real
  // buttons; Enter on the focused one does the right thing by itself.
  window.addEventListener('keydown', (e) => {
    if (element.hidden || e.key !== 'Escape') return;
    answer(false);
    e.preventDefault();
  });

  function answer(value) {
    if (element.hidden) return;
    element.hidden = true;
    const done = settle;
    settle = null;
    done?.(value);
  }

  /**
   * @param {{ title: string, body?: string, confirm?: string, danger?: boolean }} p
   * @returns {Promise<boolean>}
   */
  function ask({ title, body: text = '', confirm = L('cmd.ok'), danger = false }) {
    answer(false);
    heading.textContent = title;
    body.textContent = text;
    body.hidden = !text;
    yes.textContent = confirm;
    yes.className = `btn ${danger ? 'danger' : 'primary'}`;
    box.dataset.tone = danger ? 'danger' : 'plain';
    element.hidden = false;
    // The cancel takes focus: a reader who presses space or enter out of habit
    // should not have destroyed anything by it.
    no.focus();
    return new Promise((resolve) => { settle = resolve; });
  }

  return { element, ask };
}
