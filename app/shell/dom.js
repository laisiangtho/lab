/**
 * DOM helper. Text is always assigned as text, never parsed as HTML: verse
 * text, titles and catalog fields come from remote files.
 *
 *   h('button', { class: 'btn', onclick: fn }, 'Install')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children, el.tagName === 'BUTTON' && el.classList.contains('btn'));
  return el;
}

/**
 * Replace an element's children the way `h` fills a new one: nested arrays are
 * flattened, and null, undefined and false are skipped. The DOM's own
 * replaceChildren stringifies them, which is how "nullnull" ends up on screen.
 */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children, el.tagName === 'BUTTON' && el.classList.contains('btn'));
  return el;
}

/**
 * @param {boolean} label wrap plain text in a span the stylesheet can shorten.
 *        A button's label is written as a string at every call site, and a
 *        string beside an icon becomes an anonymous flex item — which cannot
 *        be given an ellipsis, so in a narrow pane the words were cut through
 *        the middle of a letter instead. Wrapping it here rather than at two
 *        hundred call sites keeps `h('button', { class: 'btn' }, icon('x'),
 *        'Add the passage on screen')` the way it reads.
 */
function append(el, children, label = false) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) append(el, child, label);
    else if (child instanceof Node) el.append(child);
    else if (label) el.append(h('span', { class: 'btn-t' }, String(child)));
    else el.append(document.createTextNode(String(child)));
  }
}

/**
 * A size for reading: "512 B", "8.4 MB", "837 KB" — one decimal only where
 * the number is small enough for it to say something. The one place sizes
 * are written, so the same file is the same size on every page.
 */
export function formatBytes(n) {
  if (n === null || n === undefined) return '–';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A colour (or any custom property) of the theme in force, for what is drawn on a canvas. */
export const themeValue = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Rebuild part of the page without throwing the reader back to the top.
 *
 * A document that repaints itself when something changes — the Library after an
 * install, Settings after a toggle — replaces its own children, and the
 * scrolling ancestor is left holding a shorter document for one frame, so the
 * browser clamps the scroll position to zero. What the reader sees is the page
 * jumping to the top every time they press a button, which reads as a web page
 * reloading rather than an application responding.
 *
 * So the place is taken before the rebuild and put back after it, in the same
 * frame — no flicker, because nothing has been painted in between. A control
 * that wants the focus back carries `data-place`, a name stable across the
 * rebuild.
 *
 * @param {HTMLElement} el the element whose contents `render` replaces
 * @param {() => void} render
 */
export function keepPlace(el, render) {
  const scroller = scrollParent(el);
  const top = scroller?.scrollTop ?? 0;
  const left = scroller?.scrollLeft ?? 0;
  const active = document.activeElement;
  const place = el.contains(active) ? active?.getAttribute?.('data-place') ?? null : null;

  render();

  if (scroller) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
  if (place) {
    const again = el.querySelector(`[data-place="${CSS.escape(place)}"]`);
    // preventScroll, or restoring the focus undoes the line above.
    if (again && again !== document.activeElement) again.focus({ preventScroll: true });
  }
}

/** The nearest ancestor that actually scrolls, `el` itself included. */
function scrollParent(el) {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(`${style.overflowY} ${style.overflowX}`);
    if (scrolls && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) return node;
  }
  return null;
}
