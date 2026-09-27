/**
 * Verse cards: the template a card is drawn from, and the layout maths.
 *
 * A card is a picture of a passage made to be sent somewhere this app is not —
 * a message, a slide, a printed sheet. What it should look like is therefore
 * not something this app can decide: a church has its colours, a lesson has its
 * shape, a phone screen is not a projector. So the design is data the reader
 * owns, and this module is what that data means.
 *
 * Pure. Measuring text needs a canvas, so the caller passes a measure function
 * and everything here is arithmetic.
 */

/** The shapes people actually post, plus room for their own. */
export const CARD_PRESETS = Object.freeze([
  { id: 'portrait', width: 1080, height: 1350 },
  { id: 'square', width: 1080, height: 1080 },
  { id: 'story', width: 1080, height: 1920 },
  { id: 'wide', width: 1600, height: 900 },
  { id: 'print', width: 1240, height: 1754 },
]);

export const CARD_FONTS = Object.freeze(['script', 'serif', 'sans', 'mono']);
export const CARD_ALIGN = Object.freeze(['start', 'center', 'end']);
export const CARD_BACKGROUNDS = Object.freeze(['theme', 'solid', 'gradient']);
/**
 * What happens to the frames when the card itself is resized.
 *
 * `scale` keeps their share of the card, so the design survives being made into
 * a story instead of a post; `keep` keeps their measurements, so the card grows
 * around them. Both are what somebody wants, and neither is guessable — which is
 * why it is asked rather than assumed.
 */
export const CARD_GROW = Object.freeze(['scale', 'keep']);
/** What can be picked up and moved on a card. */
export const CARD_PARTS = Object.freeze(['text', 'reference']);

export const CARD_LIMITS = Object.freeze({
  width: { min: 320, max: 4096, step: 10, default: 1080 },
  height: { min: 320, max: 4096, step: 10, default: 1350 },
  padding: { min: 24, max: 400, step: 4, default: 96 },
  size: { min: 18, max: 160, step: 1, default: 54 },
  leading: { min: 1, max: 2.6, step: 0.02, default: 1.5 },
  radius: { min: 0, max: 200, step: 2, default: 0 },
  angle: { min: 0, max: 360, step: 5, default: 135 },
  border: { min: 0, max: 40, step: 1, default: 2 },
});

export const defaultTemplate = Object.freeze({
  id: 'default',
  name: 'Default',
  width: 1080,
  height: 1350,
  padding: 96,
  radius: 0,
  background: 'theme',      // theme | solid | gradient
  from: '#1d1b26',
  to: '#2b2340',
  angle: 135,
  text: null,               // null = the running theme's colour
  accent: null,
  border: 2,
  borderInset: 48,
  font: 'script',           // script | serif | sans | mono
  /**
   * The frames, as fractions of the content box — the card inside its margin.
   *
   * This is the part that had to be rebuilt. The first version described the
   * text by an alignment and an anchor — which is a fine way to *store* a
   * layout and a hopeless way to edit one: dragging could only snap the text
   * between three places, and no handle could mean "make this box this big".
   * A frame is what every editor has and what a hand expects: it moves where it
   * is put, it resizes from the edge that is pulled, and the opposite edge
   * stays where it is. `align` is now what it says — where the text sits inside
   * its own frame — rather than where the frame sits on the card.
   *
   * They are fractions of the *content* box rather than of the whole card so
   * that the margin is a real measurement and not a decoration: 0 is the
   * margin, 1 is the other margin, and widening the margin moves the text in,
   * which is the only thing a control called "margin" can honestly mean. A
   * frame may still run outside that range — dragging text off the edge is
   * something people do on purpose — so the range is not a fence.
   */
  box: Object.freeze({ x: 0, y: 0.13, w: 1, h: 0.65 }),
  ref: Object.freeze({ x: 0, y: 0.83, w: 1 }),
  /** Which space the frames above are measured in; see `parseTemplate`. */
  space: 'inner',
  /** What resizing the card does to the frames: scale | keep. */
  grow: 'scale',
  /** The reference follows the text until it is moved, and then it is its own. */
  refFollow: true,
  refShow: true,
  size: 0,                  // 0 = fit the text to its frame
  leading: 1.5,
  align: 'start',
  /** The verse numbers' own colour, when they are not to be the text's. */
  numberColour: null,
  numbers: true,            // number the verses when there is more than one
  watermark: true,
});

/**
 * The card inside its margin: where a frame's 0 and 1 are.
 *
 * The margin is clamped against the card rather than trusted, because a margin
 * of 400 on a card 320 wide would otherwise turn the content box inside out and
 * every frame in it into a negative number.
 *
 * @param {{ width: number, height: number, padding: number }} t
 * @returns {{ x: number, y: number, width: number, height: number, pad: number }}
 */
export function contentBox(t) {
  const pad = Number.isFinite(t.padding)
    ? Math.max(0, Math.min(t.padding, Math.floor(Math.min(t.width, t.height) * 0.4)))
    : 0;
  return { x: pad, y: pad, width: t.width - pad * 2, height: t.height - pad * 2, pad };
}

/**
 * A frame read back from storage, or worked out from how the first version
 * described the same layout — an alignment, a column width and an anchor — so a
 * template written before frames existed still opens where its author left it.
 */
function frame(raw, fallback, source, flat = false) {
  // Wider than 0..1 on purpose: 0..1 is the content box, and a frame is allowed
  // to hang off it. Clamping to the box would make every drag past the margin
  // stop dead against a fence the reader never asked for.
  const unit = (value, back) => (typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, -1), 2) : back);
  if (raw && typeof raw === 'object') {
    const box = {
      x: unit(raw.x, fallback.x),
      y: unit(raw.y, fallback.y),
      w: Math.max(0.08, unit(raw.w, fallback.w)),
    };
    if (!flat) box.h = Math.max(0.06, unit(raw.h, fallback.h));
    return Object.freeze(box);
  }
  // The old shape: `measure` was a share of the room inside the margins,
  // `anchorY` where the block's middle sat in it, `align` which side it hugged.
  // That room is exactly the content box, so `measure` is already the width a
  // frame wants and the arithmetic is mostly deletion.
  const measure = typeof source?.measure === 'number' ? Math.min(Math.max(source.measure, 0.1), 1) : null;
  if (measure === null) return fallback;
  const pad = typeof source.padding === 'number' ? source.padding : 96;
  const height = typeof source.height === 'number' ? source.height : 1350;
  const room = Math.max(1, height - pad * 2);
  const w = measure;
  const x = source.align === 'center' ? (1 - w) / 2 : source.align === 'end' ? 1 - w : 0;
  if (flat) {
    const y = typeof source.refY === 'number' ? (source.refY * height - pad) / room : fallback.y;
    return Object.freeze({ x: typeof source.refX === 'number' ? (1 - w) * source.refX : x, y, w });
  }
  const h = Math.min(1, fallback.h);
  const anchor = typeof source.anchorY === 'number' ? source.anchorY : 0.5;
  return Object.freeze({ x, y: (1 - h) * anchor, w, h });
}

/**
 * A frame written in fractions of the whole card, in fractions of the content
 * box instead.
 *
 * Templates saved before the margin meant anything are in the old space, and
 * re-reading them in the new one would move everybody's cards. So they are
 * converted once, on the way in, and stamped `space: 'inner'` so it happens
 * once and not on every edit.
 */
function toInner(box, t, flat) {
  const inner = contentBox(t);
  const out = {
    x: (box.x * t.width - inner.x) / inner.width,
    y: (box.y * t.height - inner.y) / inner.height,
    w: (box.w * t.width) / inner.width,
  };
  if (!flat) out.h = (box.h * t.height) / inner.height;
  return out;
}

const clamp = (value, { min, max }, fallback) => (
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
);
const hex = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * A template read back from storage or a file, brought to the shape this build
 * draws. Nothing here throws: a card is decoration, and a template with one bad
 * field should lose that field, not the card.
 */
export function parseTemplate(raw, { id = null } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ...defaultTemplate,
    id: id ?? (typeof source.id === 'string' && source.id ? source.id : defaultTemplate.id),
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 60) : defaultTemplate.name,
    width: Math.round(clamp(source.width, CARD_LIMITS.width, defaultTemplate.width)),
    height: Math.round(clamp(source.height, CARD_LIMITS.height, defaultTemplate.height)),
    padding: Math.round(clamp(source.padding, CARD_LIMITS.padding, defaultTemplate.padding)),
    radius: Math.round(clamp(source.radius, CARD_LIMITS.radius, defaultTemplate.radius)),
    background: pick(source.background, CARD_BACKGROUNDS, defaultTemplate.background),
    from: hex(source.from, defaultTemplate.from),
    to: hex(source.to, defaultTemplate.to),
    angle: Math.round(clamp(source.angle, CARD_LIMITS.angle, defaultTemplate.angle)),
    text: source.text === null || source.text === undefined ? null : hex(source.text, null),
    accent: source.accent === null || source.accent === undefined ? null : hex(source.accent, null),
    border: Math.round(clamp(source.border, CARD_LIMITS.border, defaultTemplate.border)),
    borderInset: Math.round(clamp(source.borderInset, CARD_LIMITS.padding, defaultTemplate.borderInset)),
    font: pick(source.font, CARD_FONTS, defaultTemplate.font),
    box: frame(source.box, defaultTemplate.box, source),
    ref: frame(source.ref, defaultTemplate.ref, source, true),
    refFollow: source.refFollow === undefined
      ? (source.reference === undefined ? defaultTemplate.refFollow : source.reference !== 'free')
      : source.refFollow !== false,
    refShow: source.refShow === undefined
      ? (source.reference === undefined ? defaultTemplate.refShow : source.reference !== 'none')
      : source.refShow !== false,
    size: Math.round(clamp(source.size, { min: 0, max: CARD_LIMITS.size.max }, defaultTemplate.size)),
    leading: clamp(source.leading, CARD_LIMITS.leading, defaultTemplate.leading),
    align: pick(source.align, CARD_ALIGN, defaultTemplate.align),
    grow: pick(source.grow, CARD_GROW, defaultTemplate.grow),
    numberColour: source.numberColour === null || source.numberColour === undefined
      ? null : hex(source.numberColour, null),
    numbers: source.numbers !== false,
    watermark: source.watermark !== false,
    space: 'inner',
  };
  // An explicit frame written in the old space, measured against the whole card.
  // `frame()` has already read it; all that is left is where its 0 and 1 were.
  if (source.space !== 'inner') {
    if (source.box && typeof source.box === 'object') out.box = Object.freeze(toInner(out.box, out, false));
    if (source.ref && typeof source.ref === 'object') out.ref = Object.freeze(toInner(out.ref, out, true));
  }
  return out;
}

/**
 * What a reader starts with.
 *
 * An empty studio with one grey default is a room full of knobs and no reason
 * to touch any of them. Four finished cards are a better beginning: they show
 * what the controls are for, and three of them are probably closer to what
 * somebody wants than anything they would have built from scratch.
 */
export const STARTERS = Object.freeze([
  { id: 'starter-night', name: 'Night', background: 'gradient', from: '#241d33', to: '#120f1c', angle: 150, text: '#f2eefb', accent: '#a78bfa', numberColour: '#7c6aa8', border: 0, font: 'serif' },
  { id: 'starter-paper', name: 'Paper', background: 'solid', from: '#f6f2e9', text: '#241f1a', accent: '#8a6a32', numberColour: '#b9a17a', border: 2, borderInset: 56, font: 'serif', reference: 'corner' },
  { id: 'starter-quote', name: 'Quote', width: 1080, height: 1080, background: 'solid', from: '#0f172a', text: '#e2e8f0', accent: '#38bdf8', numberColour: null, numbers: false, border: 0, font: 'sans', align: 'center', measure: 0.82, reference: 'under' },
  { id: 'starter-story', name: 'Story', width: 1080, height: 1920, background: 'gradient', from: '#1e1b4b', to: '#4c1d95', angle: 165, text: '#ffffff', accent: '#fbbf24', border: 0, font: 'sans', align: 'start', anchorY: 0.62, reference: 'free', refX: 0.02, refY: 0.86 },
]);

/** Everything the reader has made, as it is kept in the records store. */
export function parseCardShelf(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const templates = Array.isArray(source.templates) && source.templates.length
    ? source.templates.map((t, i) => parseTemplate(t, { id: typeof t?.id === 'string' ? t.id : `t${i}` }))
    : STARTERS.map((t) => parseTemplate(t, { id: t.id }));
  const open = templates.some((t) => t.id === source.open) ? source.open : templates[0].id;
  return { templates, open };
}

/**
 * Break text into lines that fit, using whatever the caller can measure with.
 *
 * `pieces` is the text already split the language's own way — Burmese writes
 * without spaces between words, so splitting on whitespace would give one line
 * the width of a paragraph. A piece may be a bare string or `{ text, kind }`,
 * and the kind travels with it into the line, which is how a verse number can
 * be drawn in a different colour from the verse.
 *
 * @param {(string|{text: string, kind?: string})[]} pieces
 * @param {{ measure: (text: string) => number, width: number }} p
 * @returns {{ text: string, parts: { text: string, kind: string }[] }[]}
 */
export function wrapLines(pieces, { measure, width }) {
  const lines = [];
  let parts = [];
  const text = () => parts.map((part) => part.text).join('');
  const flush = () => {
    const whole = text().trim();
    if (!whole) { parts = []; return; }
    lines.push({ text: whole, parts: trimParts(parts) });
    parts = [];
  };
  for (const raw of pieces) {
    const piece = typeof raw === 'string' ? { text: raw, kind: 'text' } : { text: raw.text, kind: raw.kind ?? 'text' };
    // A newline in the source is a line the writer asked for.
    if (piece.text === '\n') { flush(); continue; }
    const next = `${text()}${piece.text}`;
    if (text().trim() && measure(next.trim()) > width) {
      flush();
      parts = [{ text: piece.text.replace(/^\s+/, ''), kind: piece.kind }];
    } else {
      parts.push(piece);
    }
  }
  flush();
  return lines;
}

/** The same, for a caller that only wants the strings. */
export function wrapPieces(pieces, options) {
  return wrapLines(pieces, options).map((line) => line.text);
}

/** Leading and trailing space belongs to the gap between lines, not to a part. */
function trimParts(parts) {
  const out = parts.map((part) => ({ ...part }));
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out.at(-1).text.trim()) out.pop();
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '');
    out[out.length - 1].text = out.at(-1).text.replace(/\s+$/, '');
  }
  return out;
}

/**
 * The largest size at which the passage still fits the room it has.
 *
 * A card with a fixed size either overflows on a long passage or wastes the
 * page on a short one, and the reader who wanted a picture of Psalm 119 should
 * not have to work out a point size. So the fit is searched for, between the
 * template's own bounds.
 *
 * @param {{ measure: (text: string, size: number) => number, pieces: string[],
 *           width: number, height: number, leading: number,
 *           min?: number, max?: number }} p
 * @returns {{ size: number, lines: string[] }}
 */
export function fitText({ measure, pieces, width, height, leading, min = 18, max = 120 }) {
  let low = min;
  let high = Math.max(min, max);
  let best = { size: min, lines: wrapLines(pieces, { measure: (t) => measure(t, min), width }) };
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const lines = wrapLines(pieces, { measure: (t) => measure(t, size), width });
    if (lines.length * size * leading <= height) {
      best = { size, lines };
      low = size + 1;
    } else {
      high = size - 1;
    }
  }
  return best;
}

/**
 * Where everything on the card goes.
 *
 * Both frames are the reader's: the text sits in one and the reference in the
 * other, and this turns those fractions into pixels and fits the words inside
 * them. The studio draws its handles from the same numbers, so what is grabbed
 * is exactly what was drawn.
 *
 * @param {{ template: object, pieces: (string|{text: string, kind?: string})[],
 *           measure: (t: string, size: number) => number,
 *           leadingScale?: number, chrome?: { reference: number, meta: number } }} p
 * @returns {{ size: number, lines: object[], step: number,
 *             box: { x, y, width, height }, text: { x, y, width, height },
 *             reference: { x, y, width, height } | null }}
 */
export function layoutCard({ template: t, pieces, measure, leadingScale = 1, chrome = { reference: 30, meta: 24 } }) {
  const inner = contentBox(t);
  const box = {
    x: Math.round(inner.x + t.box.x * inner.width),
    y: Math.round(inner.y + t.box.y * inner.height),
    width: Math.max(40, Math.round(t.box.w * inner.width)),
    height: Math.max(30, Math.round(t.box.h * inner.height)),
  };
  const leading = t.leading * leadingScale;

  const fitted = t.size > 0
    ? { size: t.size, lines: wrapLines(pieces, { measure: (text) => measure(text, t.size), width: box.width }) }
    : fitText({
      measure, pieces, width: box.width, height: box.height, leading,
      min: CARD_LIMITS.size.min, max: Math.min(CARD_LIMITS.size.max, Math.round(t.height / 8)),
    });

  const step = fitted.size * leading;
  // What the words actually take, which is never more than the frame when the
  // size is fitted and may be more when the reader has set it by hand.
  const text = {
    x: box.x,
    y: box.y,
    width: box.width,
    height: Math.max(step, fitted.lines.length * step),
  };

  const refHeight = chrome.reference * (t.watermark ? 2.6 : 1.3);
  const reference = !t.refShow ? null : t.refFollow
    ? {
      x: box.x,
      y: Math.min(text.y + text.height + chrome.reference * 0.6, t.height - refHeight - 8),
      width: box.width,
      height: refHeight,
      follows: true,
    }
    : {
      x: Math.round(inner.x + t.ref.x * inner.width),
      y: Math.round(inner.y + t.ref.y * inner.height),
      width: Math.max(40, Math.round(t.ref.w * inner.width)),
      height: refHeight,
      follows: false,
    };

  return { size: fitted.size, lines: fitted.lines, step, box, text, reference, inner };
}

/**
 * The lines a frame should snap to while it is being moved or resized.
 *
 * An editor that does not snap is an editor where nothing ever lines up, and
 * one that snaps without saying so is an editor that fights the hand. So the
 * candidates are computed here, the caller is told which ones were taken, and
 * it draws them — a guide the reader sees is a guide they can trust.
 *
 * @param {{ width: number, height: number, padding: number }} card
 * @param {{ x, y, width, height }|null} other the frame not being moved
 * @returns {{ x: number[], y: number[] }}
 */
export function snapLines(card, other = null) {
  const inner = contentBox(card);
  const x = [inner.x, card.width / 2, inner.x + inner.width];
  const y = [inner.y, card.height / 2, inner.y + inner.height];
  if (other) {
    x.push(other.x, other.x + other.width / 2, other.x + other.width);
    y.push(other.y, other.y + other.height / 2, other.y + other.height);
  }
  return { x, y };
}

/**
 * Pull a value onto the nearest line within `tolerance`.
 * @returns {{ value: number, line: number|null }}
 */
export function snapTo(value, lines, tolerance) {
  let best = null;
  for (const line of lines) {
    const gap = Math.abs(line - value);
    if (gap <= tolerance && (best === null || gap < Math.abs(best - value))) best = line;
  }
  return { value: best === null ? value : best, line: best };
}

/**
 * Move or resize a frame by a handle, in card pixels, keeping the opposite
 * edge where it is and never letting the frame turn inside out.
 *
 * @param {{ x, y, width, height }} start the frame as it was when the drag began
 * @param {{ handle: string, dx: number, dy: number, min: number }} p
 *        `handle` is 'move' or a compass point: n, s, e, w, ne, nw, se, sw.
 */
export function resizeFrame(start, { handle, dx, dy, min = 40 }) {
  const box = { ...start };
  if (handle === 'move') {
    box.x += dx;
    box.y += dy;
    return box;
  }
  if (handle.includes('w')) {
    const right = start.x + start.width;
    box.x = Math.min(start.x + dx, right - min);
    box.width = right - box.x;
  }
  if (handle.includes('e')) box.width = Math.max(min, start.width + dx);
  if (handle.includes('n')) {
    const bottom = start.y + start.height;
    box.y = Math.min(start.y + dy, bottom - min);
    box.height = bottom - box.y;
  }
  if (handle.includes('s')) box.height = Math.max(min, start.height + dy);
  return box;
}

/** A frame in card pixels, back to the fractions a template keeps. */
export function frameToTemplate(box, template, flat = false) {
  const inner = contentBox(template);
  const out = {
    x: Math.min(Math.max((box.x - inner.x) / inner.width, -1), 2),
    y: Math.min(Math.max((box.y - inner.y) / inner.height, -1), 2),
    w: Math.min(Math.max(box.width / inner.width, 0.08), 2),
  };
  if (!flat) out.h = Math.min(Math.max(box.height / inner.height, 0.06), 2);
  return out;
}

/**
 * How far apart two colours are, by WCAG's relative luminance — 1 for the same
 * colour, 21 for black on white.
 *
 * A card is made to be sent somewhere, and the failure that actually happens is
 * not an ugly card but an unreadable one: pale text on a pale ground looks fine
 * on the screen it was made on and disappears on the phone it arrives at. So
 * the studio checks, and says so, rather than leaving the reader to find out
 * from whoever received it.
 */
export function contrastRatio(a, b) {
  const one = luminance(a);
  const two = luminance(b);
  if (one === null || two === null) return null;
  const [light, dark] = one > two ? [one, two] : [two, one];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

function luminance(value) {
  const rgb = /^#[0-9a-f]{6}$/i.test(String(value ?? ''))
    ? { r: Number.parseInt(value.slice(1, 3), 16), g: Number.parseInt(value.slice(3, 5), 16), b: Number.parseInt(value.slice(5, 7), 16) }
    : null;
  if (!rgb) return null;
  const channel = (n) => {
    const c = n / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** The file an exported template is written as. */
export function buildTemplateFile(template, { appVersion = null } = {}) {
  return {
    app: 'lai-siangtho',
    kind: 'card-template',
    schema: 1,
    exportedAt: new Date().toISOString(),
    appVersion,
    template,
  };
}

/** @returns {object} the template inside a file, or null when it is not one. */
export function readTemplateFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.app !== 'lai-siangtho' || raw.kind !== 'card-template') return null;
  return parseTemplate(raw.template, { id: null });
}
