/**
 * The questions the guide answers by working the answer out rather than
 * looking it up: the time and the date, how many books, chapters and verses,
 * where the reading is, what the guide is and what it can do, where to
 * begin, the walkthrough, a greeting.
 *
 * This decides only which question was asked, and of what: `intentOf`
 * returns `{ intent, rest }`, `rest` being what is left once the asking is
 * taken off ("how many chapters in Psalms" → chapters, "psalms"). The answer
 * is the caller's, which has the clock, the canon and the reading
 * (features/guide/knowledge.js). English, Norwegian and Burmese ways of
 * asking are all read, whatever the interface's language: a reader types in
 * the language that comes first to them.
 *
 * A question that is a request ("help me make a note") is not small talk:
 * the help patterns match only a question that is about the guide itself,
 * and anything else is left to the written answers. "What can you do" is
 * recognised but answered by the written topic for it (guide.t.help), which
 * the guide already had.
 *
 * Pure.
 */

/**
 * Intent → the ways of asking it. Each pattern runs on the question lowered
 * and trimmed of its closing punctuation; a capture group, where there is
 * one, is the `rest`. Order matters: the first intent with a match wins, and
 * the counts come before anything that might read "how many" more loosely.
 */
const PATTERNS = Object.freeze([
  ['books', [
    /how many books(?: (?:are|is)(?: there)?)?(?: (?:in|of) (?:the )?)?(.*)$/,
    /hvor mange bøker(?: er det)?(?: (?:i|in) )?(.*)$/,
    /(.*)ကျမ်း\s*(?:စောင်\s*)?(?:ဘယ်နှ|မည်မျှ)/,
  ]],
  ['chapters', [
    /how many chapters(?: (?:are|is)(?: there)?)?(?: (?:in|of|does) )?(?:the )?(.*?)(?: have)?$/,
    /hvor mange kapitler(?: er det| har)?(?: (?:i|in) )?(.*)$/,
    /(.*?)\s*(?:မှာ|တွင်)?\s*အခန်းကြီး\s*(?:ဘယ်နှ|မည်မျှ)/,
  ]],
  ['verses', [
    /how many verses(?: (?:are|is)(?: there)?)?(?: (?:in|of|does) )?(?:the )?(.*?)(?: have)?$/,
    /hvor mange vers(?: er det| har)?(?: (?:i|in) )?(.*)$/,
    /(.*?)\s*(?:မှာ|တွင်)?\s*အခန်းငယ်\s*(?:ဘယ်နှ|မည်မျှ)/,
  ]],
  ['translations', [
    /how many (?:translations|bibles|versions)(?: do i have| are (?:here|there|installed))?/,
    /(?:what|which) (?:translations|bibles)(?: do i have| are (?:here|installed|on this device))/,
    /hvor mange (?:oversettelser|bibler)/,
    /ဘာသာပြန်.*(?:ဘယ်နှ|ဘာတွေ)/,
  ]],
  ['time', [
    /^what(?:'?s| is) the time(?: now)?$/, /^(?:what )?time is it(?: now)?$/, /^what time(?: is it)?(?: now)?$/,
    /^(?:the )?(?:current )?time(?: now)?$/,
    /^(?:hva|hvor mye) er klokk(?:a|en)$/, /^klokk(?:a|en)$/,
    /(?:အခု\s*)?(?:ဘယ်နှ\s*နာရီ|အချိန်\s*ဘယ်လောက်)/,
  ]],
  ['date', [
    /^what(?:'?s| is) (?:the )?(?:date|day)(?: today)?$/, /^what day is (?:it|today|it today)$/, /^(?:today'?s )?date(?: today)?$/,
    /^which day is (?:it|today)$/,
    /^(?:hvilken dag er det(?: i dag)?|hva er datoen(?: i dag)?|dato)$/,
    /(?:ဒီနေ့|ယနေ့)\s*(?:ဘယ်နေ့|ရက်စွဲ|ဘယ်ရက်)/,
  ]],
  ['where', [
    /^where am i(?: now)?$/, /^where are we(?: now)?$/, /^what am i reading(?: now)?$/, /^where was i$/,
    /^where are you(?: now)?$/,
    /^hvor er (?:jeg|vi|du)(?: nå)?$/, /^hva leser jeg(?: nå)?$/,
    /(?:ငါ|ကျွန်တော်|ကျွန်မ)?\s*(?:ဘယ်မှာ\s*(?:ရောက်|ဖတ်)|ဘာ\s*ဖတ်နေ)/,
  ]],
  ['who', [
    /^(?:who|what) are you$/, /^what(?:'?s| is) your name$/, /^who made (?:you|this(?: app)?)$/,
    /^are you (?:an? )?(?:ai|bot|robot|human|person|real|chatgpt|claude)$/, /^introduce yourself$/,
    /^(?:hvem|hva) er du$/, /^hva heter du$/,
    /(?:မင်း|နင်|သင်)\s*(?:ဘယ်သူ|ဘာ)\s*(?:လဲ|ပါလဲ)?/,
  ]],
  ['help', [
    /^(?:can|could|will) you help(?: me)?$/, /^how (?:can|could|do) you help(?: me)?$/, /^what can you do$/,
    /^what do you do$/, /^help me$/, /^help$/, /^what can i ask(?: you)?$/,
    /^kan du hjelpe(?: meg)?$/, /^hva kan du(?: gjøre)?$/, /^hjelp$/,
    /(?:ဘာ\s*ကူညီ|ကူညီ\s*(?:ပေးနိုင်|နိုင်)|ဘာ\s*လုပ်ပေးနိုင်)/,
  ]],
  ['start', [
    /^what should i do(?: now| first| next)?$/, /^where (?:do|should) i (?:start|begin)$/, /^what now$/,
    /^how do i (?:start|begin)$/, /^i(?:'m| am) (?:new|lost|stuck)(?: here)?$/, /^what next$/,
    /^hva (?:skal|bør) jeg gjøre(?: nå)?$/, /^hvor (?:skal jeg )?begynne$/, /^jeg er ny$/,
    /(?:ဘာ\s*လုပ်\s*ရမလဲ|ဘယ်က\s*စ\s*ရမလဲ)/,
  ]],
  ['tour', [
    /(?:^|\b)(?:tour|walk ?through|tutorial|show me around|onboarding)(?:\b|$)/,
    /(?:omvisning|gjennomgang|vis meg rundt)/,
    /လမ်းညွှန်ချက်/,
  ]],
  ['version', [
    /^what version(?: is this| are you)?(?: app)?$/, /^(?:app|your) version$/, /^which version is this$/,
    /^hvilken versjon(?: er dette)?$/,
  ]],
  ['thanks', [/^(?:thanks|thank you|thx|ty)(?: (?:so much|a lot|very much))?$/, /^takk(?: skal du ha)?$/, /^ကျေးဇူး/]],
  ['bye', [/^(?:bye|goodbye|see you|good night)$/, /^(?:ha det|god natt)$/]],
  ['hello', [
    /^(?:hi|hello|hey|hiya|yo|good (?:morning|afternoon|evening))(?: there)?$/, /^(?:hei|hallo|heisann|god (?:morgen|dag|kveld))$/,
    /^(?:မင်္ဂလာ|ဟယ်လို|ဟိုင်း)/,
  ]],
  ['how', [/^how are you(?: doing| today)?$/, /^hvordan (?:går det|har du det)$/, /နေကောင်းလား/]],
]);

export const INTENTS = Object.freeze(PATTERNS.map(([intent]) => intent));

/**
 * @param {string} question
 * @returns {{ intent: string, rest: string } | null}
 */
export function intentOf(question) {
  const text = String(question ?? '').normalize('NFC').toLowerCase().trim()
    .replace(/^[?¿\s]+/, '').replace(/[\s?!.。၊။]+$/u, '').replace(/\s+/g, ' ');
  if (!text) return null;
  for (const [intent, patterns] of PATTERNS) {
    for (const pattern of patterns) {
      const found = pattern.exec(text);
      if (found) return { intent, rest: (found[1] ?? '').trim().replace(/^(?:the|book of)\s+/, '') };
    }
  }
  return null;
}

/**
 * What a count is of, from what is left of the question: the whole Bible,
 * a testament, a book, or a book's chapter.
 *
 * @param {string} rest
 * @param {(text: string) => ({ book: number, chapter?: number } | null)} readPassage
 * @returns {{ scope: 'bible' } | { scope: 'testament', testament: 1|2 } |
 *           { scope: 'book', book: number } | { scope: 'chapter', book: number, chapter: number } |
 *           { scope: 'unknown', text: string }}
 */
export function scopeOf(rest, readPassage) {
  const text = String(rest ?? '').trim();
  if (!text || /^(?:the )?(?:bible|whole bible|scripture|scriptures|bibelen|bibel|သမ္မာကျမ်း(?:စာ)?)$/.test(text)) return { scope: 'bible' };
  if (/\b(?:old testament|ot|gamle testamente|det gamle testamente)\b|ဓမ္မဟောင်း/.test(text)) return { scope: 'testament', testament: 1 };
  if (/\b(?:new testament|nt|nye testamente|det nye testamente)\b|ဓမ္မသစ်/.test(text)) return { scope: 'testament', testament: 2 };
  const found = readPassage(text);
  if (!found?.book) return { scope: 'unknown', text };
  // A chapter only when one was written: "john" is the book, "john 3" its chapter.
  return /[0-9၀-၉]/.test(text.replace(/^[1-3]\s*/, '')) && found.chapter
    ? { scope: 'chapter', book: found.book, chapter: found.chapter }
    : { scope: 'book', book: found.book };
}
