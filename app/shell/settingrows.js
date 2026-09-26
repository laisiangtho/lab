/**
 * The vocabulary of the settings page: one row per thing a reader can change.
 *
 * It lives here rather than inside the settings feature because features
 * contribute their own rows to that page (`registry.setting`), and a setting
 * should not look different depending on which feature owns it. Every row is
 * the same shape — name, hint, control on the right — so the page reads as one
 * list however many features wrote it.
 *
 * Rows are plain elements. A row that has to show a new value re-reads it from
 * its own `value()` when the page repaints, which the page does by rebuilding;
 * a row that must not be rebuilt (anything the reader is dragging) updates the
 * control it owns instead.
 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { numberRow } from './numberrow.js';

/**
 * @param {{ refresh: () => void }} deps `refresh` repaints the settings page,
 *        for a row whose change makes another row stale.
 */
export function createRows({ refresh = () => {} } = {}) {
  /** The frame every row shares: what it is called, then its control. */
  function row({ name, hint = null, tag = 'div', ...rest }, ...controls) {
    return h(tag, { class: 'set-row', ...rest },
      h('span', { class: 'set-text' },
        h('span', { class: 'set-name' }, name),
        hint ? h('span', { class: 'set-hint' }, hint) : null),
      ...controls.filter(Boolean));
  }

  /** On or off. */
  function toggle({ name, hint, value, onChange, disabled = false }) {
    const input = h('input', {
      type: 'checkbox', role: 'switch', 'aria-label': name, disabled,
      onchange: (e) => onChange(e.currentTarget.checked),
    });
    input.checked = Boolean(value);
    return row({ name, hint, tag: 'label' },
      h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })));
  }

  /**
   * One of a handful of named values, all of them on show.
   *
   * An option may carry a glyph as its third field, and then the button is the
   * glyph with the words as its title and its accessible name — which is what
   * alignment, and anything else with a universally drawn symbol, should be:
   * three icons read across a room, three words do not.
   */
  function choice({ name, hint, options, value, onChange }) {
    const iconic = options.every(([, , glyph]) => Boolean(glyph));
    return row({ name, hint },
      h('div', { class: `rp-seg${iconic ? ' is-iconic' : ''}` }, options.map(([id, text, glyph]) => h('button', {
        'aria-pressed': String(id === value),
        title: glyph ? text : undefined,
        'aria-label': glyph ? text : undefined,
        onclick: () => onChange(id),
      }, glyph ? icon(glyph) : text))));
  }

  /** One of many: a list too long to lay out as buttons. */
  function select({ name, hint, options, value, onChange }) {
    const menu = h('select', {
      class: 'set-select', 'aria-label': name,
      onchange: (e) => onChange(e.currentTarget.value),
    }, options.map(([id, text]) => h('option', { value: id }, text)));
    menu.value = String(value ?? '');
    return row({ name, hint }, menu);
  }

  /** A number, draggable and typeable — the control the reading panel uses. */
  function number({ name, hint, spec, unit = '', decimals = 0, value, onChange, onCommit = null }) {
    const control = numberRow({
      label: name, spec, unit, decimals, value: () => value, onChange, onCommit,
    });
    // The control is built empty and filled by `update`, because the panel it
    // came from repaints without rebuilding. A row built once has to be filled
    // once, or the reader is handed a slider with no number beside it.
    control.update(value);
    return row({ name, hint }, h('div', { class: 'set-slider' }, control.element));
  }

  /** Something the reader does, rather than sets. */
  function action({ name, hint, label, glyph = null, onClick, kind = '', disabled = false, value = null }) {
    return row({ name, hint },
      value === null ? null : h('span', { class: 'set-value' }, value),
      h('button', { class: `btn${kind ? ` ${kind}` : ''}`, disabled, onclick: (event) => onClick(event) },
        glyph ? icon(glyph) : null, label));
  }

  /** A fact with no control: a count, a size, a state. */
  function readout({ name, hint, value }) {
    return row({ name, hint }, h('span', { class: 'set-value' }, value));
  }

  return { row, toggle, choice, select, number, action, readout, refresh };
}
