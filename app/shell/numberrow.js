/**
 * A number the reader can drag, step or type: a stepper either side of a
 * slider, with the value always visible and editable.
 *
 * Phase 1's control, kept because it covers every way of asking for a number —
 * a sweep with the pointer, a nudge with a button, an exact value typed in —
 * and because the same row is wanted in two places: the text panel over the
 * status bar, and the settings page.
 */

import { h } from './dom.js';
import { L } from './i18n.js';

/**
 * `onCommit`, where it is given, separates dragging from stopping: `onChange`
 * runs on every step of a drag and `onCommit` once at the end. A caller that
 * rebuilds anything in response to a change needs this — rebuilding on the
 * first step replaces the slider under the pointer, and the drag dies with it,
 * which is why a slider can end up behaving like a button.
 *
 * @param {{ label: string, spec: { min:number, max:number, step:number },
 *           unit?: string, decimals?: number,
 *           value: () => number, onChange: (value: number) => void,
 *           onCommit?: (value: number) => void }} p
 */
export function numberRow({ label, spec, unit = '', decimals = 0, value, onChange, onCommit = null }) {
  const clamp = (next) => Math.min(Math.max(Number(Number(next).toFixed(3)), spec.min), spec.max);
  const set = (next) => onChange(clamp(next));
  const done = (next) => (onCommit ?? onChange)(clamp(next));

  const readout = h('input', {
    type: 'number', min: spec.min, max: spec.max, step: spec.step, 'aria-label': label,
    onchange: (e) => done(e.target.value),
  });
  const slider = h('input', {
    type: 'range', min: spec.min, max: spec.max, step: spec.step, 'aria-label': label,
    oninput: (e) => set(e.target.value),
    // A range input fires `change` when the pointer is let go.
    onchange: (e) => done(e.target.value),
  });
  // The sprite has no minus glyph, so the steppers are set in type; the letter
  // sizes double as the hint for what they change.
  const stepper = (delta) => h('button', {
    class: `rp-step rp-a${delta > 0 ? '' : ' small'}`,
    'aria-label': `${label} ${delta > 0 ? '+' : '−'}`,
    title: `${label} ${delta > 0 ? '+' : '−'}`,
    onclick: () => done(value() + delta * spec.step),
  }, delta > 0 ? 'A' : 'a');

  const element = h('div', { class: 'rp-row' },
    h('span', { class: 'rp-l' }, label),
    h('div', { class: 'rp-ctl' },
      stepper(-1), slider, stepper(1),
      h('span', { class: 'rp-num' }, readout, unit ? h('i', {}, unit) : null)));

  return {
    element,
    update(next = value()) {
      slider.value = String(next);
      readout.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
    },
  };
}

/** A row of named choices — the same shape, for a setting that is not a number. */
export function choiceRow({ label, options, value, onChange }) {
  const segment = h('div', { class: 'rp-seg' });
  const element = h('div', { class: 'rp-row is-wide' }, h('span', { class: 'rp-l' }, label), segment);
  const update = () => {
    segment.replaceChildren(...options.map(([id, text]) => h('button', {
      'aria-pressed': String(id === value()),
      onclick: () => onChange(id),
    }, text ?? L(`val.${id}`))));
  };
  update();
  return { element, update };
}
