/**
 * A link to a passage: one set of manners, wherever the link is.
 *
 * Every surface in the app that names a verse — a cross-reference under a
 * verse, a wikilink in a note, a row of search results — had its own click
 * handler and its own idea of what a click meant. They agreed by accident and
 * would have drifted apart the first time one of them grew a feature. So the
 * manners live here:
 *
 *   press              follow it, in this tab, as before
 *   Ctrl/⌘ press       follow it in a new tab
 *   middle press       the same
 *   Ctrl/⌘ Enter       the same, from the keyboard
 *   hover, then wait   read it where it stands, without going anywhere
 *
 * The default is untouched on purpose. A reference opens in place because that
 * is what works on a phone and on a machine with little memory to spare, and
 * every addition here is something the reader asks for explicitly.
 *
 * **Hover is not offered where hovering is not real.** A touch device reports a
 * hover as the moment before a tap, so a preview bound to it appears under the
 * finger that is about to press the thing it covers. `canHover()` asks the
 * browser rather than guessing from the screen's width, and a device that says
 * no never arms the timer at all.
 */

const DELAY = 350;

/** Whether this device has a pointer that can rest on something. */
export function canHover() {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** Whether an event asks for a new tab rather than this one. */
export function wantsNewTab(event) {
  if (!event) return false;
  if (event.type === 'auxclick' || event.button === 1) return true;
  return Boolean(event.metaKey || event.ctrlKey);
}

/**
 * Give an element the manners above.
 *
 * @param {HTMLElement} element the link itself
 * @param {object} ref the passage it names
 * @param {{ open: (ref: object, options: object) => void,
 *           peek?: ((ref: object, anchor: HTMLElement) => void) | null,
 *           closePeek?: () => void }} handlers
 * @returns {HTMLElement} the same element, for use inline
 */
export function wireRef(element, ref, { open, peek = null, closePeek = null }) {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    closePeek?.();
    open(ref, { newTab: wantsNewTab(event) });
  });
  // The middle button is a new tab everywhere else on the web; `auxclick` is
  // where a browser reports it, and the default for it is a paste on X11.
  element.addEventListener('auxclick', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    closePeek?.();
    open(ref, { newTab: true });
  });
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    open(ref, { newTab: true });
  });

  if (!peek || !canHover()) return element;

  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  element.addEventListener('pointerenter', (event) => {
    // A pointer that arrived by touch is a finger about to press.
    if (event.pointerType && event.pointerType !== 'mouse') return;
    cancel();
    timer = setTimeout(() => { timer = null; peek(ref, element); }, DELAY);
  });
  element.addEventListener('pointerleave', cancel);
  element.addEventListener('pointerdown', cancel);
  return element;
}
