/**
 * Strips that hold more than they can show.
 *
 * Both of this app's strips — the workspace tabs and a sidebar's pane tabs —
 * face the same problem and get the same answer, so the answer lives here once.
 *
 * Scrolling a strip is the obvious thing and the wrong one. A scrollbar in a
 * 28 px band is unusable; a swipe hides the fact that there is anything to
 * swipe for; and either way the tab at the edge is drawn cut in half, which
 * reads as a fault rather than as a promise of more. So what does not fit is
 * hidden *whole*, and a button at the end says how many are behind it and
 * lists them.
 *
 * Two rules make it legible:
 *
 *  - the button is an item of the strip like any other, never an overlay. A
 *    button floating over the last tab hides the thing it is meant to reach.
 *  - the active item is never the one that disappears. If it would be, an
 *    earlier one goes instead, and the active item ends up beside the button —
 *    which is also how it stays visible in a narrow window.
 *
 * Widths come from the items themselves rather than from `scrollWidth`,
 * because both strips draw the sheet's curve with absolutely positioned
 * pseudo-elements that reach outside their box, and `scrollWidth` counts those:
 * a strip with room to spare measured as overflowing and hid everything.
 */

/**
 * @param {HTMLElement} strip
 * @param {{ items: HTMLElement[], more: HTMLElement|null, fixed?: HTMLElement[],
 *           axis?: 'x'|'y', isActive?: (el: HTMLElement) => boolean }} p
 *        `axis` is 'y' for the ribbon, which is the same strip stood on end.
 * @returns {number} how many items are hidden
 */
export function fitStrip(strip, {
  items, more, fixed = [], axis = 'x',
  isActive = (el) => el.classList.contains('is-active'),
}) {
  const down = axis === 'y';
  if (!strip.isConnected || (down ? strip.clientHeight : strip.clientWidth) === 0) return 0;
  for (const item of items) { item.hidden = false; delete item.dataset.squeezed; }
  if (more) more.hidden = true;

  const style = getComputedStyle(strip);
  const pad = down
    ? (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
    : (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0);
  const gap = Number.parseFloat(down ? style.rowGap : style.columnGap) || 0;
  const room = (down ? strip.clientHeight : strip.clientWidth) - pad;
  const width = (el) => {
    if (!el || el.hidden) return 0;
    const box = el.getBoundingClientRect();
    return (down ? box.height : box.width) + gap;
  };
  const used = () => [...items, ...fixed, more].reduce((total, el) => total + width(el), 0);
  const fits = () => used() <= room + 1;

  if (fits()) {
    strip.dataset.overflow = 'false';
    return 0;
  }

  if (more) more.hidden = false;
  let last = items.length - 1;
  while (last >= 0 && !fits()) {
    items[last].hidden = true;
    last -= 1;
  }
  const active = items.find(isActive);
  if (active?.hidden) {
    active.hidden = false;
    for (let i = last; i >= 0 && !fits(); i -= 1) {
      if (items[i] !== active) items[i].hidden = true;
    }
  }
  // Everything else is hidden and the active item still does not fit: it is
  // the one on screen, so it shrinks rather than pushing the buttons out.
  // Measured after the rest, so the squeeze never hides a tab that fits.
  if (!fits()) {
    const kept = items.find((item) => !item.hidden);
    if (kept) kept.dataset.squeezed = 'true';
  }
  const hidden = items.filter((item) => item.hidden).length;
  strip.dataset.overflow = 'true';
  if (more) more.dataset.count = String(hidden);
  return hidden;
}

/**
 * Keep a strip fitted as its width changes. Measured now for the settled case,
 * on the next frame for the case where the layout has not happened yet, and
 * whenever the strip is resized after that.
 *
 * @param {HTMLElement} strip
 * @param {() => void} measure
 * @param {WeakSet<HTMLElement>} watched
 */
export function watchStrip(strip, measure, watched) {
  measure();
  requestAnimationFrame(measure);
  if (watched.has(strip) || typeof ResizeObserver === 'undefined') return;
  watched.add(strip);
  new ResizeObserver(measure).observe(strip);
}
