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

  /**
   * What the control is showing. It is held here rather than read back from the
   * caller because the caller may not have been told yet — a drag reports every
   * step but is written down once — and because the two halves of this control
   * are one number: a slider whose figure does not move, or a figure whose
   * slider does not move, is two controls disagreeing in public.
   */
  let held = clamp(value());
  const show = (next, except = null) => {
    held = next;
    if (except !== slider) slider.value = String(next);
    if (except !== readout) readout.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
  };
  const set = (next, except = null) => { const n = clamp(next); show(n, except); onChange(n); };
  const done = (next, except = null) => { const n = clamp(next); show(n, except); (onCommit ?? onChange)(n); };

  // Typing is committed on `change` — Enter or leaving the field — and not on
  // every keystroke, because clamping a half-typed "10" of "108" to the minimum
  // takes the number away mid-word.
  const readout = h('input', {
    type: 'number', min: spec.min, max: spec.max, step: spec.step, 'aria-label': label,
    onchange: (e) => done(e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
  });
  const slider = h('input', {
    type: 'range', min: spec.min, max: spec.max, step: spec.step, 'aria-label': label,
    oninput: (e) => set(e.target.value, slider),
    // A range input fires `change` when the pointer is let go.
    onchange: (e) => done(e.target.value, slider),
  });
  // The sprite has no minus glyph, so the steppers are set in type; the letter
  // sizes double as the hint for what they change.
  const stepper = (delta) => h('button', {
    class: `rp-step rp-a${delta > 0 ? '' : ' small'}`,
    'aria-label': `${label} ${delta > 0 ? '+' : '−'}`,
    title: `${label} ${delta > 0 ? '+' : '−'}`,
    onclick: () => done(held + delta * spec.step),
  }, delta > 0 ? 'A' : 'a');

  const element = h('div', { class: 'rp-row' },
    h('span', { class: 'rp-l' }, label),
    h('div', { class: 'rp-ctl' },
      stepper(-1), slider, stepper(1),
      h('span', { class: 'rp-num' }, readout, unit ? h('i', {}, unit) : null)));

  show(held);
  return { element, update: (next = value()) => show(clamp(next)) };
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
