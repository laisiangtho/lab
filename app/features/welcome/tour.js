/**
 * The walkthrough: one part of the screen at a time, lit, with a line on
 * what it is for and what can be done with it.
 *
 * A step names what it points at by selector; a step whose target is not on
 * screen (a phone has no ribbon, a sidebar may be shut) is passed over rather
 * than pointed at nothing, and a step may open what it needs first
 * (`before`). The page under the light can still be used: the rest of the
 * screen is dimmed, not blocked, except by the card itself.
 *
 * Keys: Enter next, the arrow that points the way the text runs next and
 * the other one back, Esc ends. Ending, at any step, is final for
 * this run; the tour can be taken again from Welcome, the app menu, the
 * palette and the Guide.
 */

import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

/** Room kept between the lit part and its outline, and the card's distance from it. */
const PAD = 6;
const GAP = 12;

/**
 * @param {{ id: string, target: string|null, title: string, body: string,
 *           before?: () => (void|Promise<void>) }[]} steps
 *        `target` null is a step in the middle of the screen, about the whole
 * @param {{ onEnd?: (how: 'done'|'skipped') => void }} [options]
 * @returns {{ end: () => void }}
 */
export function runTour(steps, { onEnd = () => {} } = {}) {
  const ring = h('div', { class: 'tour-ring', 'aria-hidden': 'true' });
  const count = h('span', { class: 'tour-n' });
  const opener = document.activeElement;
  const title = h('h2', { class: 'tour-t', id: 'tour-title' });
  const body = h('p', { class: 'tour-b', id: 'tour-body' });
  const back = h('button', { class: 'btn', onclick: () => go(-1) }, icon('arrow-left'), L('tour.back'));
  const next = h('button', { class: 'btn primary', onclick: () => go(1) });
  const skip = h('button', { class: 'tour-skip', onclick: () => end('skipped') }, L('tour.skip'));
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-body' },
    h('div', { class: 'tour-top' }, count, skip),
    // Each step is said as it comes: the card is not a modal, so nothing else
    // announces that its words have changed.
    h('div', { class: 'tour-words', 'aria-live': 'polite', 'aria-atomic': 'true' }, title, body),
    h('div', { class: 'tour-acts' }, back, next));
  const layer = h('div', { class: 'tour', dataset: { step: '' } }, ring, card);
  document.body.append(layer);

  let at = -1;
  let shown = [];
  let ended = false;

  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  };
  // A step may name the same thing in more than one shell (the desktop's
  // breadcrumb, the phone's passage button): the one on screen is meant.
  const targetOf = (step) => (step.target ? [...document.querySelectorAll(step.target)].find(visible) ?? null : null);

  async function go(by) {
    let i = at + by;
    while (i >= 0 && i < steps.length) {
      const step = steps[i];
      try { await step.before?.(); } catch { /* a step that cannot prepare is passed over */ }
      // What `before` opened takes a frame to be laid out.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (ended) return;
      if (!step.target || visible(targetOf(step))) break;
      i += by;
    }
    if (i >= steps.length) { end('done'); return; }
    if (i < 0) return;
    at = i;
    if (!shown.includes(i)) shown = [...shown, i];
    paint();
  }

  function paint() {
    const step = steps[at];
    const last = !steps.slice(at + 1).some((s) => !s.target || visible(targetOf(s)));
    layer.dataset.step = step.id;
    // Counted as the reader meets them: a step for what is not on this
    // screen is neither behind nor ahead.
    const ahead = steps.slice(at + 1).filter((s) => !s.target || visible(targetOf(s))).length;
    const behind = shown.filter((i) => i < at).length;
    count.textContent = L('tour.count', { n: behind + 1, of: behind + 1 + ahead });
    title.textContent = step.title;
    body.textContent = step.body;
    back.disabled = at === 0;
    next.replaceChildren(L(last ? 'tour.done' : 'tour.next'), last ? icon('check') : icon('arrow-right'));
    place();
    // What a step opened may still be moving into place.
    setTimeout(place, 320);
    next.focus({ preventScroll: true });
  }

  /** The light over the target, and the card beside it where it fits best. */
  function place() {
    if (at < 0) return;
    const el = targetOf(steps[at]);
    if (!el || !visible(el)) {
      layer.classList.add('is-center');
      ring.style.cssText = '';
      card.style.cssText = '';
      return;
    }
    layer.classList.remove('is-center');
    const r = el.getBoundingClientRect();
    const box = {
      left: Math.max(r.left - PAD, 2), top: Math.max(r.top - PAD, 2),
      right: Math.min(r.right + PAD, innerWidth - 2), bottom: Math.min(r.bottom + PAD, innerHeight - 2),
    };
    Object.assign(ring.style, {
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`,
    });
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const room = {
      right: innerWidth - box.right, left: box.left, below: innerHeight - box.bottom, above: box.top,
    };
    let x;
    let y;
    if (room.right >= cw + GAP * 2) { x = box.right + GAP; y = box.top; }
    else if (room.left >= cw + GAP * 2) { x = box.left - GAP - cw; y = box.top; }
    else if (room.below >= ch + GAP * 2) { y = box.bottom + GAP; x = box.left; }
    else if (room.above >= ch + GAP * 2) { y = box.top - GAP - ch; x = box.left; }
    else { x = (innerWidth - cw) / 2; y = innerHeight - ch - GAP * 2; }
    x = Math.min(Math.max(x, GAP), innerWidth - cw - GAP);
    y = Math.min(Math.max(y, GAP), innerHeight - ch - GAP);
    Object.assign(card.style, { left: `${x}px`, top: `${y}px` });
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); end('skipped'); }
    else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.target.closest?.('input, textarea, select')) {
      event.preventDefault();
      const rtl = getComputedStyle(card).direction === 'rtl';
      go((event.key === 'ArrowRight') !== rtl ? 1 : -1);
    }
  }
  const onResize = () => place();

  function end(how = 'skipped') {
    if (ended) return;
    ended = true;
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    removeEventListener('scroll', onResize, true);
    layer.remove();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    onEnd(how);
  }

  addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);
  addEventListener('scroll', onResize, true);
  go(1);
  return { end: () => end('skipped') };
}
