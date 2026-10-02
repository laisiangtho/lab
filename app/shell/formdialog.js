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
 * @typedef {{ id: string, label: string, hint?: string, value?: string|string[],
 *             placeholder?: string, type?: 'text'|'choice'|'select'|'chips'|'note'|'group',
 *             fields?: Field[],
 *             show?: (values: object) => boolean,
 *             options?: { id: string, label: string, sub?: string,
 *                         show?: (values: object) => boolean }[] }} Field
 *
 * `select` is a drop-down: one answer from several, in the space of one line.
 * `chips` is several independent yes-or-no answers side by side; its value is
 * the list of ids that are on. `group` lays its own fields out on one line.
 *
 * `show` hides a field, or an option, that means nothing given the answers so
 * far — a choice about indentation for a format that has none. It is asked
 * again after every answer. A select whose answer is hidden moves to its first
 * shown option, so the values handed back are always ones that were on screen.
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
  /**
   * What the reader picked in each select, as opposed to what the dialog
   * moved it to when their pick was hidden: when the pick is shown again, it
   * comes back. Otherwise one book of USFM after all sixty-six stayed a zip,
   * because "one file" had been hidden for a moment.
   */
  let picked = {};
  let fields = [];
  let onChange = null;

  element.addEventListener('pointerdown', (e) => { if (e.target === element) finish(null); });
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); finish(null); return; }
    // Enter finishes from anywhere but a place where it means a new line.
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') { e.preventDefault(); finish(answers()); }
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
    for (const field of flat(fields)) {
      values[field.id] = field.type === 'chips' ? [...(field.value ?? [])] : field.value ?? '';
      // A choice may carry a second answer on the same line; it holds its own
      // value, and the row it shares tells nothing about it.
      if (field.free) values[field.free.id] = field.free.value ?? '';
    }
    picked = { ...values };
    onChange = options.onChange ?? null;
    title.textContent = options.title;
    lede.textContent = options.lede ?? '';
    lede.hidden = !options.lede;
    confirmButton.textContent = options.confirm ?? L('cmd.ok');
    cancelButton.textContent = options.cancel ?? L('cmd.cancel');
    confirmButton.onclick = () => finish(answers());
    cancelButton.onclick = () => finish(null);
    paint();
    refresh();
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

  /** The values, with a chip list copied so the caller cannot change ours. */
  const answers = () => Object.fromEntries(Object.entries(values)
    .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));

  /** Every field, the ones inside a group included. */
  function flat(list) {
    return list.flatMap((field) => (field.type === 'group' ? flat(field.fields ?? []) : [field]));
  }

  /**
   * Change a field's value from outside — what `onChange` uses to prefill —
   * and ask every `show` again, since what was set may be what they depend on.
   */
  function set(id, value) {
    values[id] = value;
    const note = rows.querySelector(`p.fd-live[data-field="${id}"]`);
    if (note) { note.textContent = value; refresh(); return; }
    const input = rows.querySelector(`input[data-field="${id}"], [data-field="${id}"] input[type="text"]`);
    if (input && input.value !== value) input.value = value;
    refresh();
  }

  /** Hide what means nothing now, and keep every select on an option it shows. */
  function refresh() {
    const now = answers();
    for (const field of flat(fields)) {
      const row = rows.querySelector(`[data-field="${field.id}"]`);
      if (!row) continue;
      row.hidden = field.show ? !field.show(now) : false;
      for (const option of field.options ?? []) {
        const el = row.querySelector(`[data-value="${CSS.escape(option.id)}"]`);
        if (!el) continue;
        el.hidden = option.show ? !option.show(now) : false;
        // Safari lists a hidden <option> anyway; a disabled one it cannot pick.
        if (el.tagName === 'OPTION') el.disabled = el.hidden;
      }
      if (field.type === 'select') {
        const select = row.querySelector('select');
        const shown = [...select.options].filter((o) => !o.hidden);
        const want = shown.some((o) => o.value === picked[field.id]) ? picked[field.id] : shown[0]?.value;
        if (want !== undefined && want !== values[field.id]) {
          values[field.id] = want;
          select.value = want;
        }
        // One choice left is not a question; the row says what it will be.
        select.disabled = shown.length <= 1;
      }
      if (field.type === 'chips') {
        const shown = (field.options ?? []).filter((o) => !o.show || o.show(now));
        if (!shown.length) row.hidden = true;
      }
    }
    for (const group of rows.querySelectorAll('.fd-group')) {
      group.hidden = [...group.children].every((child) => child.hidden);
    }
  }

  function paint() {
    fill(rows, fields.map(row));
  }

  function row(field) {
    // A line the dialog writes to itself as the answers change: what
    // will come of it, before the button that does it is pressed.
    if (field.type === 'note') {
      return h('p', { class: 'fd-live', dataset: { field: field.id } }, values[field.id] ?? '');
    }
    if (field.type === 'group') {
      return h('div', { class: 'fd-group' }, ...(field.fields ?? []).map(row));
    }
    const changed = () => { refresh(); onChange?.({ ...values }, set); };
    let control;
    if (field.type === 'choice') control = choice(field);
    else if (field.type === 'select') control = select(field, changed);
    else if (field.type === 'chips') control = chips(field, changed);
    else {
      control = h('input', {
        type: 'text', spellcheck: 'false', value: values[field.id] ?? '',
        placeholder: field.placeholder ?? '',
        'aria-label': field.label,
        oninput: (e) => { values[field.id] = e.currentTarget.value; changed(); },
      });
    }
    // A chip row is a set of buttons, and a label round it would make a click
    // anywhere on the row press the first chip.
    return h(field.type === 'chips' ? 'div' : 'label', { class: 'fd-row', dataset: { field: field.id } },
      h('span', { class: 'fd-label' },
        h('span', { class: 'fd-name' }, field.label),
        field.hint ? h('span', { class: 'fd-hint' }, field.hint) : null),
      control);
  }

  /** A drop-down: the platform's own, so it is right on a phone and from a keyboard. */
  function select(field, changed) {
    const control = h('select', {
      class: 'fd-select', 'aria-label': field.label,
      onchange: (e) => { values[field.id] = e.currentTarget.value; picked[field.id] = values[field.id]; changed(); },
    }, ...(field.options ?? []).map((option) => h('option', {
      value: option.id, dataset: { value: option.id },
    }, option.label)));
    control.value = values[field.id];
    return control;
  }

  /** Independent switches in a row, each a pressed-or-not button. */
  function chips(field, changed) {
    return h('div', { class: 'fd-chips', role: 'group', 'aria-label': field.label },
      ...(field.options ?? []).map((option) => h('button', {
        type: 'button', class: 'fd-chip', dataset: { value: option.id },
        'aria-pressed': String(values[field.id].includes(option.id)),
        onclick: (e) => {
          const on = !values[field.id].includes(option.id);
          values[field.id] = on
            ? [...values[field.id], option.id]
            : values[field.id].filter((id) => id !== option.id);
          e.currentTarget.setAttribute('aria-pressed', String(on));
          changed();
        },
      }, option.label)));
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
        refresh();
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
          refresh();
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
