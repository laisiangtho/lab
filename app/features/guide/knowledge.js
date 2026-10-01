/**
 * What the app knows about itself, as one thing to ask — the core behind
 * every place a reader can ask it:
 *
 *   the Help page   in the workspace: a question at the top, the answers
 *                   under it, and everything there is to know laid out below
 *   the Guide pane  in a sidebar: a conversation, one answer at a time
 *   the palette     "? how do I …": the best answers as rows to press
 *
 * Each view draws the same answers with the same buttons (cards.js); none of
 * them keeps its own list of topics, its own memory of what helped, or its
 * own copy of the downloaded answers.
 *
 * What it answers from, in the interface's language: topics written for it
 * (`guide.t.*`), every command and palette verb in this build, every
 * document, every setting with its sentence, and the answers downloaded from
 * the guide data repository. A build with fewer features knows fewer things,
 * and never offers a button that is not there.
 */

import { ask, createIndex, learn, readMemory } from '../../core/guide.js';
import { intentOf, scopeOf } from '../../core/converse.js';
import { BUILT_AT, VERSION } from '../../version.js';
import { currentLocale, hasString, L, stringKeys, when } from '../../shell/i18n.js';
import { GUIDE_KEY } from './index.js';

/**
 * Topics written for the guide. The words are `guide.t.<id>.title`, `.q` (the
 * ways somebody might ask, one to a line) and `.a` (the answer). `does` is
 * what its button does; a topic whose command this build lacks keeps its
 * answer and loses the button.
 */
export const TOPICS = Object.freeze([
  { id: 'start', does: { doc: 'library' } },
  { id: 'offline', does: { doc: 'library' } },
  { id: 'passage', does: { cmd: 'shell.switcher' } },
  { id: 'parallel', does: { cmd: 'reading.add-pane' } },
  { id: 'search', does: { cmd: 'search.open' } },
  { id: 'bookmark', does: { pane: ['left', 'marks'] } },
  { id: 'note', does: { cmd: 'composer.open' } },
  { id: 'run', does: null },
  { id: 'plan', does: { cmd: 'plan.open' } },
  { id: 'card', does: { palette: 'card ' } },
  { id: 'project', does: { doc: 'projects' } },
  { id: 'export', does: { doc: 'library' } },
  { id: 'import', does: { cmd: 'library.import' } },
  { id: 'backup', does: { doc: 'settings' } },
  { id: 'language', does: { doc: 'settings' } },
  { id: 'theme', does: { cmd: 'shell.theme' } },
  { id: 'aloud', does: { cmd: 'speech.toggle' } },
  { id: 'keys', does: { doc: 'shortcuts' } },
  { id: 'privacy', does: { doc: 'about' } },
  { id: 'strongs', does: { cmd: 'reading.strongs' } },
  { id: 'study', does: { palette: 'study ' } },
  { id: 'originals', does: { doc: 'library' } },
  { id: 'interlinear', does: { cmd: 'reading.interlinear' } },
  { id: 'layout', does: { cmd: 'reading.panel' } },
  { id: 'compare', does: { palette: 'compare ' } },
  { id: 'link', does: null },
  { id: 'memory', does: { doc: 'memory' } },
  { id: 'streak', does: { cmd: 'plan.open' } },
  { id: 'guide', does: { doc: 'settings' } },
  { id: 'help', does: null },
]);

/** The topics a newcomer is offered first, before anything has been asked. */
export const STARTERS = Object.freeze(['start', 'offline', 'search', 'note']);

/**
 * What Help says a command is for, where it says it: the one sentence a
 * command otherwise lacks.
 */
const COMMAND_TEXT = Object.freeze({
  'shell.switcher': 'doc.t.switcher',
  'shell.palette': 'doc.t.palette',
  'reading.add-pane': 'doc.t.parallel',
  'search.open': 'doc.t.search',
  'composer.open': 'doc.t.composer',
  'graph.open': 'doc.t.graph',
  'plan.open': 'doc.t.plan',
  'speech.toggle': 'doc.t.read',
  'help.shortcuts': 'doc.t.shortcuts',
  'help.about': 'doc.t.about',
  'settings.open': 'doc.t.settings',
  'help.formats': 'doc.t.formats',
});

/**
 * A sentence for each document. A document missing here still gets
 * `guide.opensDoc`: an answer card with a title and nothing under it read as
 * a fault, and was one.
 */
const DOC_TEXT = Object.freeze({
  help: 'guide.doc.help', shortcuts: 'doc.t.shortcuts', formats: 'doc.t.formats', about: 'doc.t.about',
  settings: 'doc.t.settings', welcome: 'doc.t.welcome', graph: 'doc.t.graph', library: 'guide.doc.library',
  projects: 'guide.doc.projects', cards: 'guide.doc.cards', board: 'guide.doc.board', memory: 'guide.doc.memory',
  'notes-manager': 'guide.doc.notes', report: 'guide.doc.report', voices: 'guide.doc.voices',
});

/**
 * @param {object} ctx the app context
 * @param {{ guideData: ReturnType<import('../../services/guidedata.js').createGuideData> }} deps
 */
export function createKnowledge(ctx, { guideData }) {
  const { records, registry, shell } = ctx;
  const events = new EventTarget();
  const builtIn = gather(ctx);
  let entries = builtIn;
  let index = createIndex(entries);
  let byId = new Map(entries.map((entry) => [entry.id, entry]));
  let memory = readMemory(records.get(GUIDE_KEY, null));
  let downloaded = { topics: 0, questions: 0 };
  let busy = false;
  /** What a download in progress last said, for whichever view is showing. */
  let progress = '';

  const emit = () => events.dispatchEvent(new CustomEvent('change'));

  /** The built-in answers and the downloaded ones, as one index. */
  async function rebuild() {
    const files = await guideData.held();
    const extra = downloadedEntries(files, currentLocale());
    entries = [...builtIn, ...extra.entries];
    index = createIndex(entries);
    byId = new Map(entries.map((entry) => [entry.id, entry]));
    downloaded = { topics: extra.topics, questions: extra.entries.length };
    emit();
  }

  /**
   * Download, or bring up to date, the answers for this language (and
   * English). Its progress is `progress`, announced by a change.
   */
  async function fetchMore() {
    if (busy) return;
    busy = true;
    const say = (text) => { progress = text; emit(); };
    say(L('guide.data.checking'));
    try {
      const langs = [...new Set([currentLocale(), 'en'])];
      const result = await guideData.update(langs, ({ done, total }) => { if (total) say(L('guide.data.progress', { n: done, of: total })); });
      await rebuild();
      const changed = result.added + result.updated + result.removed;
      shell.notify(changed ? L('guide.data.done', { n: downloaded.topics }) : L('guide.data.current'), 'ok');
      if (result.failed.length) {
        const shown = result.failed.slice(0, 3).map((f) => f.message).join(' · ');
        shell.notify(L('guide.data.failed', { n: result.failed.length, list: shown }), 'error');
      }
    } catch (err) {
      shell.notify(L('guide.data.error', { why: err.message }), 'error');
    } finally {
      busy = false;
      progress = '';
      emit();
    }
  }

  /**
   * The answers to a question, best first: a passage when it names one,
   * otherwise the entries it matches, one to a title.
   *
   * @returns {{ passage: object|null, hits: { entry: object, score: number, learned: boolean }[] }}
   */
  function answer(question, { limit = 3 } = {}) {
    // Worked out before anything is looked up: "how many verses in John 3"
    // names a passage, and is a question about it, not a way to go there.
    const said = worked(question);
    if (said) return { passage: null, hits: [{ entry: said, score: 10, learned: false }] };
    const passage = shell.readPassage(question);
    if (passage?.book) return { passage, hits: [] };
    return { passage: null, hits: distinct(ask(index, question, { memory, limit: limit + 5 })).slice(0, limit) };
  }

  /** What an entry's button does, in this build — or nothing, if it cannot. */
  function runnable(does) {
    if (!does) return null;
    if (does.cmd) {
      if (!registry.hasCommand(does.cmd)) return null;
      return { glyph: 'arrow-right', label: L('guide.doIt'), run: () => shell.run(does.cmd) };
    }
    if (does.doc) {
      if (!registry.getDoc(does.doc)) return null;
      return { glyph: 'arrow-right', label: L('guide.open'), run: () => shell.openDoc(does.doc) };
    }
    if (does.pane) {
      // A topic written here names its side; a downloaded one names only the
      // pane, and the pane's own registration says where it lives.
      const id = Array.isArray(does.pane) ? does.pane[1] : does.pane;
      const pane = registry.panes().find((p) => p.id === id);
      if (!pane) return null;
      return { glyph: 'arrow-right', label: L('guide.open'), run: () => shell.selectPane(pane.side, id) };
    }
    if (does.passage) {
      const { book, chapter, verse } = does.passage;
      const name = passageName(shell, does.passage);
      return {
        glyph: 'book-open', label: L('guide.goTo', { where: name }),
        run: () => (verse ? shell.openVerse(book, chapter, verse) : shell.openChapter(book, chapter)),
      };
    }
    if (does.palette) {
      return { glyph: 'cmd', label: L('guide.tryIt'), run: () => shell.openPaletteWith(does.palette) };
    }
    return null;
  }

  // --- answers worked out ---------------------------------------------------

  /** The translations on this device, kept current for answers asked synchronously. */
  let installed = [];
  const countInstalled = () => ctx.store.list().then((rows) => { installed = rows; }).catch(() => {});
  countInstalled();
  ctx.library?.on('change', countInstalled);

  const number = (n) => new Intl.NumberFormat(currentLocale()).format(n);
  const bookName = (id) => shell.workspace.bookName(id);
  /**
   * A book, and a chapter if one is written, from typed text: in the
   * translation's own names first, then the canon's English names and
   * abbreviations — "psalms" is asked while a Danish Bible is open.
   */
  function readBook(text) {
    const own = shell.readPassage(text);
    if (own?.book) return own;
    const found = /^([1-3]?\s*[\p{L}][\p{L}\s.]*?)\s*(\d+)?$/u.exec(String(text).trim().toLowerCase());
    if (!found) return null;
    const name = found[1].replace(/\s+/g, ' ').replace(/\.$/, '').trim();
    const plain = (value) => String(value).toLowerCase().replace(/\s+/g, ' ').trim();
    const book = ctx.category.books.find((b) => [b.name, b.shortname, ...(b.abbr ?? [])].some((n) => plain(n) === name))
      ?? ctx.category.books.find((b) => plain(b.name).replace(/s$/, '') === name.replace(/s$/, ''));
    return book ? { book: book.id, chapter: Number(found[2] ?? 1) } : null;
  }

  const live = (id, title, text = '', does = null) => ({ id: `live.${id}`, title, text, does, prior: 1, live: true });

  /**
   * The answer to a question of the kinds core/converse.js recognises, as an
   * entry like any other — a title, a sentence, a button — or null. The
   * counts are the canon's (category.json): a translation that numbers
   * differently differs by a few verses.
   */
  function worked(question) {
    const found = intentOf(question);
    if (!found) return null;
    const { category, state } = ctx;
    const now = new Date();
    const at = state.get();
    const reading = installed.length && at.book ? passageName(shell, { book: at.book, chapter: at.chapter }) : null;
    const versesOf = (book) => category.book(book).verses.reduce((n, v) => n + v, 0);
    const books = (testament) => category.books.filter((b) => !testament || b.testament === testament);
    const sum = (list, of) => list.reduce((n, b) => n + of(b), 0);
    const testamentName = (id) => L(id === 1 ? 'cv.ot' : 'cv.nt');
    switch (found.intent) {
      case 'time':
        return live('time', L('cv.time', { time: now.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }) }),
          L('cv.timeNote', { date: now.toLocaleDateString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }));
      case 'date':
        return live('date', L('cv.date', { date: now.toLocaleDateString(currentLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }),
          L('cv.dateNote', { time: when.time(now) }));
      case 'books':
      case 'chapters':
      case 'verses': {
        const scope = scopeOf(found.rest, readBook);
        if (scope.scope === 'unknown') return live('nobook', L('cv.noBook', { text: scope.text }), L('cv.noBookNote'));
        if (scope.scope === 'bible') {
          const [ot, nt] = [books(1), books(2)];
          if (found.intent === 'books') return live('books', L('cv.books', { n: number(ot.length + nt.length) }), L('cv.booksNote', { ot: number(ot.length), nt: number(nt.length) }));
          if (found.intent === 'chapters') return live('chapters', L('cv.chapters', { n: number(sum([...ot, ...nt], (b) => b.chapters)) }), L('cv.split', { ot: number(sum(ot, (b) => b.chapters)), nt: number(sum(nt, (b) => b.chapters)) }));
          return live('verses', L('cv.verses', { n: number(sum([...ot, ...nt], (b) => versesOf(b.id))) }), `${L('cv.split', { ot: number(sum(ot, (b) => versesOf(b.id))), nt: number(sum(nt, (b) => versesOf(b.id))) })} ${L('cv.numbering')}`);
        }
        if (scope.scope === 'testament') {
          const list = books(scope.testament);
          const span = L('cv.span', { first: bookName(list[0].id), last: bookName(list.at(-1).id) });
          const n = found.intent === 'books' ? list.length : found.intent === 'chapters' ? sum(list, (b) => b.chapters) : sum(list, (b) => versesOf(b.id));
          return live(`${found.intent}.t${scope.testament}`, L(`cv.${found.intent}In`, { n: number(n), where: testamentName(scope.testament) }), span);
        }
        const book = category.book(scope.book);
        const go = { passage: { book: book.id, chapter: scope.scope === 'chapter' ? scope.chapter : 1 } };
        if (scope.scope === 'chapter' && found.intent === 'verses') {
          if (scope.chapter > book.chapters) return live('nochapter', L('cv.noChapter', { book: bookName(book.id), n: number(book.chapters) }), '', { passage: { book: book.id, chapter: 1 } });
          return live('verses.c', L('cv.versesIn', { n: number(category.verseCount(book.id, scope.chapter)), where: passageName(shell, { book: book.id, chapter: scope.chapter }) }), L('cv.numbering'), go);
        }
        if (found.intent === 'books') return live('books.one', L('cv.oneBook', { book: bookName(book.id) }), '', go);
        if (found.intent === 'chapters') return live('chapters.b', L('cv.chaptersIn', { n: number(book.chapters), where: bookName(book.id) }), L('cv.bookIn', { testament: testamentName(book.testament) }), go);
        return live('verses.b', L('cv.versesIn', { n: number(versesOf(book.id)), where: bookName(book.id) }), `${L('cv.inChapters', { n: number(book.chapters) })} ${L('cv.numbering')}`, go);
      }
      case 'translations':
        return installed.length
          ? live('translations', L('cv.translations', { n: number(installed.length) }), installed.slice(0, 8).map((row) => row.info?.shortname || row.identify).join(', '), { doc: 'library' })
          : live('translations', L('cv.noTranslations'), L('cv.noTranslationsNote'), { doc: 'library' });
      case 'where':
        if (/\b(?:you|du)\b/.test(String(question).toLowerCase())) {
          return live('whereyou', L('cv.whereYou'), reading ? L('cv.whereYouNote', { where: reading, tr: shell.workspace.primaryName() }) : L('cv.privateNote'));
        }
        return reading
          ? live('where', L('cv.where', { where: reading }), L('cv.whereNote', { tr: shell.workspace.primaryName() }), { passage: { book: at.book, chapter: at.chapter } })
          : live('where', L('cv.nowhere'), L('cv.noTranslationsNote'), { doc: 'library' });
      case 'who':
        return live('who', L('cv.who'), L('cv.whoNote'), { doc: 'help' });
      // Answered by the written topic for it, which says the same at more length.
      case 'help':
        return null;
      case 'start':
        return installed.length
          ? live('start', L('cv.start'), L('cv.startNote'), { cmd: 'welcome.tour' })
          : live('start', L('cv.noTranslations'), L('cv.noTranslationsNote'), { doc: 'library' });
      case 'tour':
        return live('tour', L('tour.cmd'), L('cv.tourNote'), { cmd: 'welcome.tour' });
      case 'version':
        return live('version', L('cv.version', { version: VERSION }), L('cv.versionNote', { date: when.date(BUILT_AT) }), { doc: 'about' });
      case 'hello':
        return live('hello', L('cv.hello'), L('cv.helloNote'));
      case 'how':
        return live('how', L('cv.how'), L('cv.helloNote'));
      case 'thanks':
        return live('thanks', L('cv.thanks'), L('cv.thanksNote'));
      case 'bye':
        return live('bye', L('cv.bye'), L('cv.byeNote'));
      default:
        return null;
    }
  }

  function remember(question, id, delta) {
    memory = learn(memory, question, id, delta);
    records.save(GUIDE_KEY, memory).catch((err) => shell.notify(err.message, 'error'));
  }

  // The downloaded answers join once they are read, a moment after the
  // knowledge is first wanted.
  const ready = rebuild().catch((err) => shell.notify(L('guide.data.error', { why: err.message }), 'error'));

  return {
    ready,
    answer,
    runnable,
    remember,
    /** What was learned is gone (Settings → Study): start again from nothing. */
    forget: () => { memory = readMemory(null); },
    fetchMore,
    entry: (id) => byId.get(id) ?? null,
    /** The written topics, in their order: what Help lays out to browse. */
    topics: () => TOPICS.map((topic) => byId.get(`topic.${topic.id}`)).filter(Boolean),
    starters: () => STARTERS.map((id) => byId.get(`topic.${id}`)).filter(Boolean),
    get downloaded() { return downloaded; },
    get busy() { return busy; },
    get progress() { return progress; },
    on: (type, fn) => { events.addEventListener(type, fn); return () => events.removeEventListener(type, fn); },
  };
}

/** "Genesis 1:3", in the reader's own book names and numerals. */
export function passageName(shell, { book, chapter, verse }) {
  const where = shell.workspace;
  return `${where.bookName(book)} ${where.number(chapter)}${verse ? `:${where.number(verse)}` : ''}`;
}

/**
 * Downloaded answers in the interface language, and in English for a topic
 * nobody has written in it yet — shown as English, not passed off as a
 * translation. A topic is its path under the language folder.
 */
function downloadedEntries(files, locale) {
  const topicOf = (path) => path.split('/').slice(2).join('/');
  const mine = files.filter((file) => file.lang === locale);
  const covered = new Set(mine.map((file) => topicOf(file.path)));
  const english = locale === 'en' ? [] : files.filter((file) => file.lang === 'en' && !covered.has(topicOf(file.path)));
  const chosen = [...mine, ...english];
  return {
    topics: chosen.length,
    entries: chosen.flatMap((file) => file.entries.map((entry) => ({ ...entry, prior: 1.2 }))),
  };
}

/**
 * One answer per title: the Library is a document and a command, and offering
 * it twice under one name is noise.
 */
function distinct(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const key = hit.entry.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Everything the guide can answer with, in the interface's language, from
 * what this build actually has.
 */
function gather({ registry }) {
  const out = [];
  const lines = (key) => (hasString(key) ? L(key).split('\n').map((line) => line.trim()).filter(Boolean) : []);

  for (const topic of TOPICS) {
    const base = `guide.t.${topic.id}`;
    if (!hasString(`${base}.title`)) throw new Error(`guide: topic "${topic.id}" has no ${base}.title`);
    out.push({
      id: `topic.${topic.id}`, title: L(`${base}.title`), text: L(`${base}.a`), phrases: lines(`${base}.q`),
      does: topic.does, keys: topic.does?.cmd ? registry.commands().find((c) => c.id === topic.does.cmd)?.keys ?? '' : '',
      prior: 1.4,
    });
  }

  for (const command of registry.commands()) {
    if (typeof command.title !== 'string') continue;
    out.push({
      id: `cmd.${command.id}`, title: command.title,
      text: COMMAND_TEXT[command.id] && hasString(COMMAND_TEXT[command.id]) ? L(COMMAND_TEXT[command.id]) : L('guide.runsCmd'),
      does: { cmd: command.id }, keys: command.keys ?? '', prior: 0.9,
    });
  }

  for (const verb of registry.verbs()) {
    if (verb.word === 'ask') continue;
    out.push({
      id: `verb.${verb.word}`, title: verb.title, text: verb.hint || L('guide.runsCmd'), phrases: [verb.word],
      does: { palette: `${verb.word} ` }, prior: 0.9,
    });
  }

  for (const doc of registry.docs()) {
    const key = DOC_TEXT[doc.id];
    out.push({ id: `doc.${doc.id}`, title: doc.title, text: key && hasString(key) ? L(key) : L('guide.opensDoc'), does: { doc: doc.id }, prior: 0.8 });
  }

  // Every setting has a name and a sentence (`set.theme`, `set.themeHint`).
  if (registry.getDoc('settings')) {
    for (const key of stringKeys()) {
      const found = /^set\.([A-Za-z]+)Hint$/.exec(key);
      if (!found || !hasString(`set.${found[1]}`)) continue;
      const hint = L(key);
      // A hint with a placeholder is written for a value the guide does not have.
      if (/\{\w+\}/.test(hint)) continue;
      out.push({ id: `set.${found[1]}`, title: L(`set.${found[1]}`), text: hint, does: { doc: 'settings' }, prior: 0.85 });
    }
  }
  return out;
}
