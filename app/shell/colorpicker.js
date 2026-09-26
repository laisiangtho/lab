/**
 * A colour picker: a saturation/value field, a hue bar, and a hex field.
 *
 * The browser's own `<input type="color">` opens the operating system's picker,
 * which is a different shape on every platform, cannot be styled to match, and
 * on the desktop build opens a window over the app. This one is drawn in the
 * app, behaves the same everywhere, and follows the shell's rule for dragging:
 * the pointer is captured, the listeners live on the window, and the value is
 * reported continuously so the accent changes under the reader's finger.
 *
 * Colour maths is plain HSV: a square of saturation across and value down, a
 * bar of hue beside it. Nothing here is specific to the accent — it reports a
 * hex string and knows nothing about what it is for.
 */

import { h } from './dom.js';
import { L } from './i18n.js';

export function createColorPicker() {
  let onPick = null;
  let onSettle = null;
  let onDone = null;
  let hsv = { h: 265, s: 0.8, v: 0.9 };

  const thumb = h('div', { class: 'cp-thumb' });
  const field = h('div', { class: 'cp-field' }, thumb);
  const hueThumb = h('div', { class: 'cp-thumb cp-hue-thumb' });
  const hue = h('div', { class: 'cp-hue' }, hueThumb);
  const swatch = h('div', { class: 'cp-swatch' });
  const hex = h('input', {
    class: 'cp-hex', spellcheck: 'false', 'aria-label': L('lbl.colourValue'),
    onchange: (e) => {
      const parsed = parseHex(e.currentTarget.value);
      if (!parsed) { paint(); return; }
      hsv = rgbToHsv(parsed);
      paint();
      report();
      settle();
    },
  });

  const element = h('div', { class: 'popover colorpicker', hidden: true, role: 'dialog' },
    h('div', { class: 'cp-body' }, field, hue),
    h('div', { class: 'cp-foot' }, swatch, hex));

  let anchor = null;
  document.addEventListener('pointerdown', (e) => {
    if (element.hidden || element.contains(e.target) || anchor?.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (!element.hidden && e.key === 'Escape') close(); });

  drag(field, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; paint(); report(); });
  drag(hue, (x) => { hsv = { ...hsv, h: x * 360 }; paint(); report(); });

  /**
   * Press, move, release — on the window, so a pointer that leaves the element
   * mid-drag keeps steering it, and a release anywhere ends it.
   *
   * A drag reports continuously so the colour can be previewed, and settles
   * once on release. The two are separate because previewing is a variable
   * written to the document, while settling is a change to the reader's
   * settings — and doing the second on every pointer move repaints the app
   * under their hand.
   */
  function drag(surface, onMove) {
    surface.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const rect = surface.getBoundingClientRect();
      const at = (e) => onMove(
        clamp((e.clientX - rect.left) / rect.width),
        clamp((e.clientY - rect.top) / rect.height),
      );
      at(event);
      const move = (e) => at(e);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        settle();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  function paint() {
    const colour = hsvToHex(hsv);
    field.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`;
    thumb.style.left = `${hsv.s * 100}%`;
    thumb.style.top = `${(1 - hsv.v) * 100}%`;
    thumb.style.background = colour;
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.style.background = `hsl(${hsv.h} 100% 50%)`;
    swatch.style.background = colour;
    if (document.activeElement !== hex) hex.value = colour;
  }

  function report() {
    onPick?.(hsvToHex(hsv));
  }

  /** The colour the reader stopped on: worth remembering, unlike every step to it. */
  function settle() {
    onSettle?.(hsvToHex(hsv));
  }

  function close() {
    const wasOpen = !element.hidden;
    if (wasOpen) settle();
    element.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
    const done = onDone;
    onPick = null;
    onSettle = null;
    onDone = null;
    if (wasOpen) done?.();
  }

  /**
   * @param {HTMLElement} from the control it belongs to
   * @param {{ value?: string, onChange: (hex: string) => void,
   *           onCommit?: (hex: string) => void, onClose?: () => void }} p
   *        `onChange` runs on every step of a drag — paint with it, nothing
   *        more. `onCommit` runs once the reader stops, and is where the choice
   *        is written down. `onClose` runs when the picker goes away, which is
   *        when whatever was holding still for the drag may move again.
   */
  function open(from, { value = null, onChange, onCommit = null, onClose = null }) {
    if (anchor === from && !element.hidden) { close(); return; }
    anchor = from;
    onPick = onChange;
    onSettle = onCommit;
    onDone = onClose;
    from.setAttribute('aria-expanded', 'true');
    hsv = rgbToHsv(parseHex(value) ?? { r: 124, g: 58, b: 237 });
    element.hidden = false;
    paint();
    place();
  }

  function place() {
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 8), window.innerWidth - width - 8);
    const below = rect.bottom + 8;
    element.style.left = `${left}px`;
    element.style.top = `${below + height > window.innerHeight - 8 ? Math.max(rect.top - height - 8, 8) : below}px`;
  }

  return { element, open, close };
}

const clamp = (n) => Math.min(Math.max(n, 0), 1);

/** `#7c3aed` or `#abc` → { r, g, b }, or null when it is not a colour. */
export function parseHex(value) {
  const text = String(value ?? '').trim().replace(/^#/, '');
  const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHsv({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  let hue = 0;
  if (span !== 0) {
    if (max === red) hue = ((green - blue) / span) % 6;
    else if (max === green) hue = (blue - red) / span + 2;
    else hue = (red - green) / span + 4;
  }
  // The hue is kept as it comes out of the maths, not rounded to whole
  // degrees: a degree is worth about one step of a channel, and a colour that
  // came from a hex string has to give the same hex string back.
  return { h: ((hue * 60) + 360) % 360, s: max === 0 ? 0 : span / max, v: max };
}

export function hsvToHex({ h: hue, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
      : hue < 180 ? [0, c, x]
        : hue < 240 ? [0, x, c]
          : hue < 300 ? [x, 0, c]
            : [c, 0, x];
  const byte = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}
