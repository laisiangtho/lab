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
  append(el, children);
  return el;
}

/**
 * Replace an element's children the way `h` fills a new one: nested arrays are
 * flattened, and null, undefined and false are skipped. The DOM's own
 * replaceChildren stringifies them, which is how "nullnull" ends up on screen.
 */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function formatBytes(n) {
  if (n === null || n === undefined) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

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
