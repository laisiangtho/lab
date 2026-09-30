/**
 * Language codes: the three-letter code a translation file carries, and the
 * tag the browser will actually act on.
 *
 * Bible translations name their language by its ISO 639-3 code — "mya", "ctd",
 * "nob" — because that is the code that can name every language there is. The
 * browser's own machinery is keyed the other way: `:lang(my)` does not match
 * `lang="mya"`, a speech engine reports its Burmese voice as `my-MM`, and a
 * font stack chosen for `lang="ctd"` is chosen for nothing at all. So something
 * has to map 639-3 onto 639-1 where a 639-1 exists.
 *
 * It turns out the browser already knows. CLDR carries the equivalences as
 * locale aliases, and `Intl.Locale` applies them while canonicalising:
 *
 *   mya → my    nob → nb    cmn → zh    tgl → fil    swh → sw    heb → he
 *   ctd → ctd   lus → lus   kac → kac   shn → shn    tpi → tpi   grc → grc
 *
 * The second row is the important one. A code that stays three letters has no
 * two-letter form — that is a fact about the language, not a failure to look it
 * up — and it is very nearly the same set of languages no device ships a voice
 * for. Saying so plainly is more use to a reader than a guess.
 *
 * `EXTRA` is for what CLDR does not carry. It is short on purpose: a
 * hand-maintained copy of a standard is a copy that goes wrong quietly, so
 * nothing belongs in it that `Intl` already answers.
 *
 * Pure, and safe where `Intl` is missing or refuses a code.
 */

/**
 * Codes CLDR does not alias, mapped by hand.
 *
 * Kept deliberately small. Add one only with the reason it is here: a language
 * a catalog actually publishes, whose 639-1 code the browser does not know.
 */
const EXTRA = Object.freeze({
  // Macrolanguage members whose 639-1 belongs to the macrolanguage. CLDR aliases
  // some of these and not others, and which ones changes between ICU versions.
  cmn: 'zh', // Mandarin → Chinese
  yue: 'zh', // Cantonese → Chinese
  nan: 'zh', // Min Nan → Chinese
  arb: 'ar', // Standard Arabic → Arabic
  swh: 'sw', // Kiswahili → Swahili
  pes: 'fa', // Western Persian → Persian
  zsm: 'ms', // Standard Malay → Malay
  ekk: 'et', // Standard Estonian → Estonian
  lvs: 'lv', // Standard Latvian → Latvian
  khk: 'mn', // Halh Mongolian → Mongolian
  npi: 'ne', // Nepali → Nepali
  ory: 'or', // Odia → Odia
  pnb: 'pa', // Western Panjabi → Panjabi
});

const THREE = /^[a-z]{3}$/;
const TWO = /^[a-z]{2}$/;

/** A code as this module compares them: lower case, no region, no underscore. */
export function baseCode(value) {
  return String(value ?? '').trim().toLowerCase().replace('_', '-').split('-')[0];
}

/**
 * The two-letter (ISO 639-1) code for a language, or null when it has none.
 *
 * Null is an answer. A language with no 639-1 code is most of the languages
 * this app exists for, and telling a reader "there is no voice for Tedim" is
 * the truth; quietly substituting a neighbouring language would not be.
 *
 * @param {string} code a 639-3 or 639-1 code, with or without a region
 * @returns {string|null}
 */
export function twoLetter(code) {
  const base = baseCode(code);
  if (TWO.test(base)) return base;
  if (!THREE.test(base)) return null;
  if (EXTRA[base]) return EXTRA[base];
  const canonical = viaIntl(base);
  return canonical && TWO.test(canonical) ? canonical : null;
}

/** What `Intl` makes of a code, or '' where it is absent or refuses. */
function viaIntl(base) {
  try {
    // `Intl.Locale` applies CLDR's language aliases while canonicalising, which
    // is the whole mapping — for codes it knows.
    return new Intl.Locale(base).language.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The tag to put in a `lang` attribute or hand to a speech engine: the
 * two-letter code where one exists, otherwise the code as given.
 *
 * Unlike `twoLetter` this never returns null, because `lang="ctd"` is still
 * better than no `lang` at all — it is what a screen reader and a font stack
 * have to go on, and it is correct, merely unrecognised.
 */
export function toTag(code) {
  const base = baseCode(code);
  if (!base) return '';
  return twoLetter(base) ?? base;
}

/**
 * Whether two codes name the same language, comparing on the two-letter form
 * where both have one. This is the question a voice list asks: `my-MM` and
 * `mya` are the same language, and `ctd` and `my` are not.
 */
export function sameLanguage(a, b) {
  const one = toTag(a);
  const two = toTag(b);
  return Boolean(one) && one === two;
}

/**
 * A readable name for a code, in the reader's own interface language.
 *
 * The caller should prefer the name the translation file carries — a file that
 * says "Tedim, Zolai, Chin" knows better than any table — and fall back to this
 * for a bare code. `Intl.DisplayNames` returns the code itself when it has no
 * name for it, which is the right thing to show and worth nothing to hide.
 */
export function languageName(code, locale = undefined) {
  const base = baseCode(code);
  if (!base) return '';
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'language' }).of(base) ?? base;
  } catch {
    return base;
  }
}

/**
 * Languages written right to left, by two-letter code where one exists. What
 * `Intl.Locale#getTextInfo` answers where it is available; this list is for
 * where it is not, and for the three-letter codes it does not know.
 */
const RTL = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'yi', 'ps', 'dv', 'sd', 'ug', 'ckb', 'syr', 'arc', 'sam', 'nqo', 'rhg']);

/**
 * Which way a language is written, from its code. A file that says nothing
 * about direction — every OSIS, USFM and Zefania file — would otherwise have
 * Hebrew and Arabic laid out left to right.
 *
 * @returns {'rtl'|'ltr'}
 */
export function directionOf(code) {
  const base = baseCode(code);
  if (!base) return 'ltr';
  const tag = twoLetter(base) ?? base;
  if (RTL.has(tag) || RTL.has(base)) return 'rtl';
  try {
    const locale = new Intl.Locale(tag);
    const info = typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : locale.textInfo;
    if (info?.direction === 'rtl') return 'rtl';
  } catch {
    // An unknown code is written left to right as far as anyone here knows.
  }
  return 'ltr';
}
