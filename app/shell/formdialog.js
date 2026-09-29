/**
 * A dialog that asks a few things at once.
 *
 * The app already has a modal for choosing from a list and a confirm for yes or
 * no, and neither can ask "what is this file, and what should it be called".
 * This is that third shape and nothing more: a title, a line of explanation,
 * some rows, and two buttons.
 *
 * It resolves with the values, or with null when the reader backs out —
 * cancelling is an answer and never an error.
 */

import { h, fill } from './dom.js';
import { L } from './i18n.js';

/**
 * @typedef {{ id: string, label: string, hint?: string, value?: string,
 *             placeholder?: string, type?: 'text'|'choice',
 *             options?: { id: string, label: string, sub?: string }[] }} Field
 */

export function createFormDialog() {
  const title = h('h2', { class: 'fd-title' });
  const lede = h('p', { class: 'fd-lede' });
  const rows = h('div', { class: 'fd-rows' });
  const confirmButton = h('button', { class: 'btn primary' });
  const cancelButton = h('button', { class: 'btn' });
  const box = h('div', { class: 'fd', role: 'dialog', 'aria-modal': 'true' },
    title, lede, rows,
    h('div', { class: 'fd-acts' }, cancelButton, confirmButton));
  const element = h('div', { class: 'scrim', hidden: true }, box);

  let settle = null;
  let values = {};
  let fields = [];
  let onChange = null;

  element.addEventListener('pointerdown', (e) => { if (e.target === element) finish(null); });
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); finish(null); return; }
    // Enter finishes from anywhere but a place where it means a new line.
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); finish({ ...values }); }
  });

  function finish(result) {
    if (!settle) return;
    const done = settle;
    settle = null;
    element.hidden = true;
    done(result);
  }

  /**
   * @param {{ title: string, lede?: string, fields: Field[], confirm?: string,
   *           cancel?: string, onChange?: (values: object, set: Function) => void }} options
   * @returns {Promise<object|null>}
   */
  function open(options) {
    fields = options.fields ?? [];
    values = {};
    for (const field of fields) {
      values[field.id] = field.value ?? '';
      // A choice may carry a second answer on the same line; it holds its own
      // value, and the row it shares tells nothing about it.
      if (field.free) values[field.free.id] = field.free.value ?? '';
    }
    onChange = options.onChange ?? null;
    title.textContent = options.title;
    lede.textContent = options.lede ?? '';
    lede.hidden = !options.lede;
    confirmButton.textContent = options.confirm ?? L('cmd.ok');
    cancelButton.textContent = options.cancel ?? L('cmd.cancel');
    confirmButton.onclick = () => finish({ ...values });
    cancelButton.onclick = () => finish(null);
    paint();
    // Once on open, so a live line says something before anything is pressed.
    onChange?.({ ...values }, set);
    element.hidden = false;
    // The first thing that can be typed in, or the button, so the dialog is
    // usable from the keyboard the moment it appears. Not a field beside a row
    // of choices — that one is the exception to them, and opening on it says
    // the choices are the afterthought.
    (rows.querySelector('input[type="text"]:not(.fd-free)') ?? confirmButton).focus();
    return new Promise((resolve) => { settle = resolve; });
  }

  /** Change a field's value from outside — what `onChange` uses to prefill. */
  function set(id, value) {
    values[id] = value;
    const note = rows.querySelector(`p.fd-live[data-field="${id}"]`);
    if (note) { note.textContent = value; return; }
    const input = rows.querySelector(`input[data-field="${id}"], [data-field="${id}"] input[type="text"]`);
    if (input && input.value !== value) input.value = value;
  }

  function paint() {
    fill(rows, fields.map((field) => {
      // A line the dialog writes to itself as the answers change: what you
      // will get, before you press the button that gets it.
      if (field.type === 'note') {
        return h('p', { class: 'fd-live', dataset: { field: field.id } }, values[field.id] ?? '');
      }
      const control = field.type === 'choice'
        ? choice(field)
        : h('input', {
          type: 'text', spellcheck: 'false', value: values[field.id] ?? '',
          placeholder: field.placeholder ?? '',
          'aria-label': field.label,
          oninput: (e) => { values[field.id] = e.currentTarget.value; onChange?.({ ...values }, set); },
        });
      return h('label', { class: 'fd-row', dataset: { field: field.id } },
        h('span', { class: 'fd-label' },
          h('span', { class: 'fd-name' }, field.label),
          field.hint ? h('span', { class: 'fd-hint' }, field.hint) : null),
        control);
    }));
  }

  /**
   * A row of choices, and optionally a field for an answer none of them covers.
   *
   * `free` is that field: a second value on the same line, for the case where
   * the options are the usual answers rather than all of them. Naming
   * something is more specific than picking a segment, so typing takes the
   * group over — the buttons step back rather than disappear, and pressing one
   * clears what was typed.
   */
  function choice(field) {
    const free = field.free ?? null;
    const group = h('div', { class: 'fd-opts' });
    let typed = null;

    const buttons = (field.options ?? []).map((option) => h('button', {
      type: 'button',
      class: 'fd-opt',
      dataset: { value: option.id },
      'aria-pressed': String(option.id === values[field.id]),
      onclick: () => {
        values[field.id] = option.id;
        for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === option.id));
        if (typed) { typed.value = ''; values[free.id] = ''; group.dataset.free = '0'; }
        onChange?.({ ...values }, set);
      },
    }, h('span', { class: 'fd-opt-n' }, option.label),
      option.sub ? h('span', { class: 'fd-opt-s' }, option.sub) : null));

    group.append(...buttons);
    if (free) {
      typed = h('input', {
        type: 'text', class: 'fd-free', spellcheck: 'false', dataset: { field: free.id },
        value: values[free.id] ?? '', placeholder: free.placeholder ?? '',
        'aria-label': free.label ?? field.label,
        oninput: (e) => {
          values[free.id] = e.currentTarget.value;
          group.dataset.free = e.currentTarget.value.trim() ? '1' : '0';
          onChange?.({ ...values }, set);
        },
      });
      group.dataset.free = String(values[free.id] ?? '').trim() ? '1' : '0';
      group.append(typed);
    }
    return group;
  }

  return { element, open, close: () => finish(null) };
}
