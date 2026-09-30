/**
 * Theme and accent, carried over from Phase 1: the ramp swaps at :root, no
 * component rule is theme aware.
 *
 * The preference lives in settings (and therefore in an export); the resolved
 * theme is written to html[data-theme] so CSS alone does the rest.
 */

export const THEME_CYCLE = ['system', 'dark', 'light'];
export const THEME_ICON = { system: 'monitor', dark: 'moon', light: 'sun' };

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  return media?.matches ? 'dark' : 'light';
}

export function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

const ACCENT_PROPS = ['--accent', '--accent-1', '--accent-2-on-dark', '--accent-2-on-light', '--accent-fade', '--accent-line'];

/**
 * The rows accent text sits on in each theme (--bg-secondary); the text must
 * read on them plain, and under the tint a soft button lays over them.
 */
const GROUND = { dark: '#1e1e1e', light: '#f6f6f6' };
const TINT = 0.14;
const READABLE = 4.5;

/**
 * The accent as text in one theme: lifted towards white on the dark ground,
 * taken towards black on the light one, by the least amount that reaches
 * 4.5:1 against that theme's row, plain and with the accent's tint — starting
 * from the usual amount, so a colour that already reads keeps its character.
 * The picker accepts any colour, so no fixed amount would do: 35% towards
 * black leaves a bright yellow at under 3:1.
 */
export function accentText(value, theme) {
  const toward = theme === 'light' ? '#000000' : '#ffffff';
  // Plain (a link on the row) and tinted (a soft button's label).
  const grounds = [GROUND[theme], mix(GROUND[theme], value, TINT)];
  for (let amount = theme === 'light' ? 0.35 : 0.34; amount < 1; amount += 0.05) {
    const shade = mix(value, toward, amount);
    if (grounds.every((ground) => contrast(shade, ground) >= READABLE)) return shade;
  }
  return toward;
}

/**
 * A chosen accent, or null for the stylesheet's own.
 *
 * The accent as text (--accent-2) needs a different shade per theme. Written
 * as one inline value, lifted towards white, it overrode the light theme's own
 * and left accent text at 1.6–2.3:1 there; each theme now takes its own shade
 * (shell.css). Every property this writes comes off together — removing only
 * --accent used to leave the rest of a cleared accent behind.
 */
export function applyAccent(value) {
  const root = document.documentElement.style;
  for (const prop of ACCENT_PROPS) root.removeProperty(prop);
  if (!value) return;
  root.setProperty('--accent', value);
  root.setProperty('--accent-1', mix(value, '#ffffff', 0.18));
  root.setProperty('--accent-2-on-dark', accentText(value, 'dark'));
  root.setProperty('--accent-2-on-light', accentText(value, 'light'));
  root.setProperty('--accent-fade', rgba(value, TINT));
  root.setProperty('--accent-line', rgba(value, 0.42));
}

/** Follow the system while the preference is "system". */
export function watchSystemTheme(getPref) {
  media?.addEventListener('change', () => { if (getPref() === 'system') applyTheme('system'); });
}

/**
 * A computed colour ("rgb(12, 12, 14)", or "rgba(…, 1)") as "#rrggbb". A colour
 * that is not opaque has no single value to hand on, and is refused by name.
 */
export function cssColorToHex(value) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(String(value).trim());
  if (!m) throw new Error(`cssColorToHex: not an rgb() colour: ${value}`);
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha !== 1) throw new Error(`cssColorToHex: not opaque: ${value}`);
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function channels(hex) {
  const v = hex.replace('#', '');
  const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

function mix(hex, other, amount) {
  const a = channels(hex);
  const b = channels(other);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(hex, alpha) {
  return `rgba(${channels(hex).join(',')},${alpha})`;
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = channels(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
