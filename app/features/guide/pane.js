/**
 * The guide's pane, loaded the first time it is shown.
 *
 * One field at the foot, the exchange above it. An answer is a card: what it
 * is, one or two sentences, the shortcut if there is one, and the button that
 * does it — so "how do I bookmark a verse" is answered by the app doing it, not
 * by a paragraph about where the button is. Under the card, the next best
 * answers as single lines, and two quiet words for whether it helped.
 *
 * A question that names a passage is answered with the passage. A question
 * nothing in the guide answers says so plainly, and offers the two things that
 * might: searching the Bible for those words, and Help.
 */

import { ask, createIndex, learn, readMemory } from '../../core/guide.js';
import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { keyLabel } from '../../shell/keys.js';
import { hasString, L, stringKeys } from '../../shell/i18n.js';
import { GUIDE_KEY } from './index.js';

/**
 * Topics written for the guide. The words are `guide.t.<id>.title`, `.q` (the
 * ways somebody might ask, one to a line) and `.a` (the answer). `does` is
 * what its button does; a topic whose command this build lacks keeps its
 * answer and loses the button.
 */
const TOPICS = Object.freeze([
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
  { id: 'layout', does: { cmd: 'reading.panel' } },
  { id: 'guide', does: { doc: 'settings' } },
]);

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

/** The first questions offered, before anything has been asked. */
const STARTERS = Object.freeze(['start', 'offline', 'search', 'note']);

export function mountGuide(el, ctx) {
  const { records, registry, shell } = ctx;
  const entries = gather(ctx);
  const index = createIndex(entries);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let memory = readMemory(records.get(GUIDE_KEY, null));

  const log = h('div', { class: 'gd-log', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'gd-input', rows: 1, spellcheck: 'false',
    placeholder: L('guide.placeholder'), 'aria-label': L('guide.placeholder'),
    oninput: () => grow(),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    },
  });
  const send = h('button', {
    class: 'gd-send', type: 'submit', title: L('guide.send'), 'aria-label': L('guide.send'),
  }, icon('arrow-right'));
  const clear = h('button', {
    class: 'gd-clear', type: 'button', hidden: true, title: L('guide.clear'), 'aria-label': L('guide.clear'),
    onclick: () => { exchanges = 0; paintHello(); input.focus(); },
  }, icon('x'));
  const form = h('form', { class: 'gd-foot', onsubmit: (e) => { e.preventDefault(); submit(); } }, input, send);
  const root = h('div', { class: 'guide' }, clear, log, form);
  fill(el, root);

  let exchanges = 0;
  paintHello();

  function grow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function submit() {
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    grow();
    answer(question);
  }

  function paintHello() {
    clear.hidden = true;
    const starters = STARTERS.map((id) => byId.get(`topic.${id}`)).filter(Boolean);
    fill(log, h('div', { class: 'gd-hello' },
      h('span', { class: 'gd-hello-mark' }, icon('guide')),
      h('p', { class: 'gd-hello-t' }, L('guide.hello')),
      h('p', { class: 'gd-hello-s' }, L('guide.helloSub')),
      h('div', { class: 'gd-starters' }, starters.map((entry) => h('button', {
        type: 'button', class: 'gd-starter',
        onclick: () => answer(entry.title, entry.id),
      }, entry.title)))));
  }

  /**
   * Answer a question. `chosen` is the entry a starter button stands for:
   * pressing "Getting started" means that topic, whatever else its words find.
   */
  function answer(question, chosen = null) {
    if (!exchanges) fill(log);
    exchanges += 1;
    clear.hidden = false;
    const block = h('section', { class: 'gd-x' }, h('p', { class: 'gd-q' }, question));

    const passage = chosen ? null : shell.readPassage(question);
    if (passage?.book) {
      block.append(passageCard(question, passage));
    } else {
      const found = chosen ? [{ entry: byId.get(chosen), score: 1, learned: false }] : distinct(ask(index, question, { memory, limit: 8 })).slice(0, 3);
      if (!found.length) block.append(missCard(question));
      else {
        block.append(card(question, found[0]));
        const rest = found.slice(1);
        if (rest.length) {
          block.append(h('div', { class: 'gd-more' },
            h('span', { class: 'gd-more-l' }, L('guide.also')),
            ...rest.map((hit) => h('button', {
              type: 'button', class: 'gd-more-i',
              onclick: (e) => { e.currentTarget.closest('.gd-more').replaceWith(card(question, hit)); },
            }, hit.entry.title))));
        }
      }
    }
    log.append(block);
    block.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  function card(question, { entry, learned }) {
    const keys = entry.keys ? keyLabel(entry.keys).map((key) => h('kbd', { class: 'kbd' }, key)) : [];
    const acts = h('div', { class: 'gd-acts' });
    const action = runnable(entry.does);
    if (action) {
      acts.append(h('button', {
        type: 'button', class: 'btn soft gd-do',
        onclick: () => { remember(question, entry.id, +1); action.run(); },
      }, icon(action.glyph), action.label));
    }
    const feedback = h('span', { class: 'gd-fb' },
      h('button', {
        type: 'button', class: 'gd-fb-b', title: L('guide.helpful'),
        onclick: () => { remember(question, entry.id, +1); feedback.replaceChildren(h('span', { class: 'gd-fb-done' }, L('guide.thanks'))); },
      }, L('guide.helpful')),
      h('button', {
        type: 'button', class: 'gd-fb-b', title: L('guide.notThis'),
        onclick: () => {
          remember(question, entry.id, -1);
          feedback.replaceChildren(h('span', { class: 'gd-fb-done' }, L('guide.noted')));
        },
      }, L('guide.notThis')));
    acts.append(h('span', { class: 'spacer' }), feedback);
    return h('article', { class: 'gd-card', dataset: { entry: entry.id } },
      h('h3', { class: 'gd-t' }, entry.title, keys.length ? h('span', { class: 'gd-keys' }, ...keys) : null),
      entry.text ? h('p', { class: 'gd-a' }, entry.text) : null,
      learned ? h('p', { class: 'gd-learned' }, L('guide.learned')) : null,
      acts);
  }

  function passageCard(question, passage) {
    const where = shell.workspace;
    const name = `${where.bookName(passage.book)} ${where.number(passage.chapter)}${passage.verse ? `:${where.number(passage.verse)}` : ''}`;
    return h('article', { class: 'gd-card' },
      h('h3', { class: 'gd-t' }, name),
      h('div', { class: 'gd-acts' }, h('button', {
        type: 'button', class: 'btn soft gd-do',
        onclick: () => (passage.verse
          ? shell.openVerse(passage.book, passage.chapter, passage.verse)
          : shell.openChapter(passage.book, passage.chapter)),
      }, icon('book-open'), L('guide.goTo', { where: name }))));
  }

  /** Nothing answers: say so, and offer what might. */
  function missCard(question) {
    const find = registry.verbs().find((verb) => verb.word === 'find');
    return h('article', { class: 'gd-card gd-miss' },
      h('p', { class: 'gd-a' }, L('guide.miss')),
      h('div', { class: 'gd-acts' },
        find ? h('button', {
          type: 'button', class: 'btn soft gd-do', onclick: () => find.run(question),
        }, icon('search'), L('guide.searchBible', { q: question })) : null,
        h('button', { type: 'button', class: 'btn gd-do', onclick: () => shell.openDoc('help') }, icon('help'), L('doc.help'))));
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
      const [side, id] = does.pane;
      if (!registry.panes().some((p) => p.id === id)) return null;
      return { glyph: 'arrow-right', label: L('guide.open'), run: () => shell.selectPane(side, id) };
    }
    if (does.palette) {
      return { glyph: 'cmd', label: L('guide.tryIt'), run: () => shell.openPaletteWith(does.palette) };
    }
    return null;
  }

  function remember(question, id, delta) {
    memory = learn(memory, question, id, delta);
    records.save(GUIDE_KEY, memory).catch((err) => shell.notify(err.message, 'error'));
  }

  return {
    ask: (question) => { answer(question); },
    dispose: () => {},
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
      text: COMMAND_TEXT[command.id] && hasString(COMMAND_TEXT[command.id]) ? L(COMMAND_TEXT[command.id]) : '',
      does: { cmd: command.id }, keys: command.keys ?? '', prior: 0.9,
    });
  }

  for (const verb of registry.verbs()) {
    if (verb.word === 'ask') continue;
    out.push({
      id: `verb.${verb.word}`, title: verb.title, text: verb.hint ?? '', phrases: [verb.word],
      does: { palette: `${verb.word} ` }, prior: 0.9,
    });
  }

  for (const doc of registry.docs()) {
    out.push({ id: `doc.${doc.id}`, title: doc.title, does: { doc: doc.id }, prior: 0.8 });
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
