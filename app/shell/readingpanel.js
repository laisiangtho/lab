/**
 * Reading panel: the size of the scripture, the size of the interface around
 * it, line height, line length and verse layout — applied as CSS variables and
 * kept in settings — and what is shown besides the verses: headings,
 * cross-references, how words with a Strong's number look, the interlinear
 * line.
 *
 * The panel is built once and only its values change, so choosing a layout
 * cannot move it under the pointer. It points at the control that opened it.
 */

import { READING, STRONGS_MODES } from '../core/settings.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { L } from './i18n.js';
import { numberRow } from './numberrow.js';

/**
 * The typography variables go on the root element, not on the body: the ramp
 * derives `--fs-text` from `--reading-size` at `:root`, and a custom property
 * is resolved where it is declared. Set on the body, the whole panel moved
 * numbers that the text never saw.
 */
export function applyReading({ readingSize, readingLeading, readingMeasure, uiSize, readingFont, motion }) {
  const style = document.documentElement.style;
  style.setProperty('--reading-size', `${readingSize}px`);
  style.setProperty('--lh-text', String(readingLeading));
  style.setProperty('--measure-em', String(readingMeasure));
  // The interface ramp and the heights of the controls are both derived from
  // this one number, so a larger label never outgrows its box.
  style.setProperty('--ui-size', `${uiSize ?? READING.ui.default}px`);
  document.body.dataset.measure = readingMeasure >= READING.measure.max ? 'full' : 'set';
  // Two settings that are a switch rather than a number, and belong with the
  // rest of what the document looks like: the scripture's typeface, and whether
  // anything moves. Both are read by the stylesheet off the body.
  document.body.dataset.font = readingFont ?? 'serif';
  document.body.dataset.motion = motion === false ? 'off' : 'on';
}

export function createReadingPanel(ctx) {
  const row = (labelKey, key, spec, unit, decimals) => numberRow({
    label: L(labelKey), spec, unit, decimals,
    value: () => ctx.state.get()[key],
    onChange: (value) => { ctx.state.set({ [key]: value }); paint(); },
  });
  const rows = {
    size: row('lbl.textSize', 'readingSize', READING.size, 'px', 0),
    leading: row('lbl.lineHeight', 'readingLeading', READING.leading, '', 2),
    measure: row('lbl.lineLength', 'readingMeasure', READING.measure, 'ch', 0),
    ui: row('lbl.uiSize', 'uiSize', READING.ui, 'px', 0),
  };
  // The box is three questions a reader has, in the order they are asked:
  // how big, how laid out, and what else is on the page besides the words.
  const segment = h('div', { class: 'rp-seg rp-layouts' });
  const LAYOUT_ICON = { paragraph: 'lay-para', list: 'lay-list', continuous: 'lay-flow' };

  /** Something shown or not: its mark, its name, a line on what it is, a switch. */
  const switches = {};
  const shownRow = (key, glyph, name, hint) => {
    const input = h('input', {
      type: 'checkbox', role: 'switch', 'aria-label': L(name), dataset: { show: key },
      onchange: (e) => { ctx.state.set({ [key]: e.currentTarget.checked }); paint(); },
    });
    switches[key] = input;
    return h('label', { class: 'rp-item', title: L(hint) },
      h('span', { class: 'rp-item-i' }, icon(glyph)),
      h('span', { class: 'rp-item-t' }, h('span', { class: 'rp-item-n' }, L(name)), h('span', { class: 'rp-item-h' }, L(hint))),
      h('span', { class: 'switch' }, input, h('span', { class: 'switch-track' })));
  };
  // Words with a Strong's number: four ways to show them, each drawn on a
  // sample word the way the text will draw it, so the choice is seen before
  // it is made.
  const words = h('div', { class: 'rp-words', role: 'radiogroup', 'aria-label': L('sw.title') });
  const wordsHint = h('span', { class: 'rp-item-h' });
  const wordsRow = h('div', { class: 'rp-item is-stack' },
    h('span', { class: 'rp-item-i' }, icon('strongs')),
    h('span', { class: 'rp-item-t' }, h('span', { class: 'rp-item-n' }, L('sw.title')), wordsHint),
    words);
  const section = (glyph, name, ...content) => h('section', { class: 'rp-sec' },
    h('h3', { class: 'rp-l' }, icon(glyph), h('span', {}, L(name))), ...content);

  const reset = h('button', { class: 'rp-reset', onclick: () => { resetAll(); paint(); } }, L('cmd.reset'));
  const panel = h('div', { class: 'popover rpanel has-arrow', hidden: true },
    section('type', 'rp.type', rows.size.element, rows.leading.element, rows.measure.element),
    section('lay-para', 'cmd.layout', segment),
    section('eye', 'rp.inText',
      shownRow('headings', 'heading', 'cmd.headings', 'set.headingsHint'),
      shownRow('xrefs', 'link', 'cmd.xrefs', 'set.xrefsHint'),
      wordsRow,
      shownRow('interlinear', 'compare', 'cmd.interlinear', 'rp.interlinearHint')),
    h('section', { class: 'rp-sec' }, rows.ui.element),
    h('div', { class: 'rp-foot' }, h('span', {}, L('lbl.readingHint')), reset));


  let anchor = null;

  document.addEventListener('pointerdown', (e) => {
    if (panel.hidden || panel.contains(e.target) || anchor?.contains(e.target)) return;
    close();
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (!panel.hidden && anchor) place(anchor); });

  function resetAll() {
    ctx.state.set({
      readingSize: READING.size.default,
      readingLeading: READING.leading.default,
      readingMeasure: READING.measure.default,
      uiSize: READING.ui.default,
    });
  }

  /** The height the panel had when it was last placed. */
  let placedAt = 0;

  /**
   * Values only — never geometry, or the panel would jump under the pointer.
   * The one exception is its own height: the interface size changes the height
   * of every row in here, and a panel anchored above its control has to move
   * its top edge to stay on screen.
   */
  function paint() {
    const s = ctx.state.get();
    rows.size.update(s.readingSize);
    rows.leading.update(s.readingLeading);
    rows.measure.update(s.readingMeasure);
    rows.ui.update(s.uiSize);
    segment.replaceChildren(...ctx.shell.workspace.layouts.map((id) => h('button', {
      'aria-pressed': String(id === s.layout),
      onclick: () => { ctx.state.set({ layout: id }); paint(); },
    }, LAYOUT_ICON[id] ? icon(LAYOUT_ICON[id]) : null, h('span', {}, L(`val.${id}`)))));
    for (const [key, input] of Object.entries(switches)) input.checked = Boolean(s[key]);
    words.replaceChildren(...STRONGS_MODES.map((id) => h('button', {
      class: 'rp-word', role: 'radio', 'aria-checked': String(id === s.strongsMode), dataset: { wordsPick: id },
      title: L(`sw.${id}Hint`),
      onclick: () => { ctx.state.set({ strongsMode: id }); paint(); },
    },
      h('span', { class: 'rp-word-s', dataset: { words: id }, 'aria-hidden': 'true' },
        h('span', { class: 'strongs' }, L('sw.sample'), id === 'numbers' ? h('sup', { class: 'strongs-code' }, 'H1697') : null)),
      h('span', { class: 'rp-word-n' }, L(`sw.${id}`)))));
    wordsHint.textContent = L(`sw.${s.strongsMode}Hint`);
    if (!panel.hidden && anchor && panel.offsetHeight !== placedAt) place(anchor);
  }

  function place(from) {
    const rect = from.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const above = rect.top > height + 20;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 10), window.innerWidth - width - 10);
    panel.classList.toggle('is-above', above);
    panel.style.left = `${left}px`;
    // A panel taller than the room above or below its control is pulled back
    // onto the screen rather than hanging off the edge.
    const top = above ? rect.top - height - 10 : rect.bottom + 10;
    panel.style.top = `${Math.min(Math.max(top, 8), Math.max(window.innerHeight - height - 8, 8))}px`;
    placedAt = height;
    panel.style.setProperty('--arrow-x', `${Math.min(Math.max(rect.left + rect.width / 2 - left, 16), width - 16)}px`);
  }

  function open(from) {
    anchor = from;
    paint();
    panel.hidden = false;
    place(from);
  }

  function close() { panel.hidden = true; }

  return { element: panel, open, close, paint, toggle: (from) => (panel.hidden ? open(from) : close()) };
}
