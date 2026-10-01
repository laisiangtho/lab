/**
 * An answer, drawn: the same card wherever the question was asked — the Help
 * page or the Guide pane. What it is, one or two sentences, the shortcut if
 * there is one, the button that does it, and two quiet words for whether it
 * helped.
 */

import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { keyLabel } from '../../shell/keys.js';
import { currentLocale, L } from '../../shell/i18n.js';
import { passageName } from './knowledge.js';
import { refText } from '../../core/studydata.js';

/**
 * @param {ReturnType<import('./knowledge.js').createKnowledge>} knowledge
 * @param {string} question what was asked, so "helped" is learned against it
 * @param {{ entry: object, learned?: boolean }} hit
 */
export function answerCard(knowledge, question, { entry, learned = false }) {
  const keys = entry.keys ? keyLabel(entry.keys).map((key) => h('kbd', { class: 'kbd' }, key)) : [];
  const acts = h('div', { class: 'gd-acts' });
  const action = knowledge.runnable(entry.does);
  if (action) {
    acts.append(h('button', {
      type: 'button', class: 'btn soft gd-do',
      onclick: () => { knowledge.remember(question, entry.id, +1); action.run(); },
    }, icon(action.glyph), action.label));
  }
  const feedback = h('span', { class: 'gd-fb' },
    h('button', {
      type: 'button', class: 'gd-fb-b', title: L('guide.helpful'),
      onclick: () => {
        knowledge.remember(question, entry.id, +1);
        feedback.replaceChildren(h('span', { class: 'gd-fb-done' }, L('guide.thanks')));
      },
    }, L('guide.helpful')),
    h('button', {
      type: 'button', class: 'gd-fb-b', title: L('guide.notThis'),
      onclick: () => {
        knowledge.remember(question, entry.id, -1);
        feedback.replaceChildren(h('span', { class: 'gd-fb-done' }, L('guide.noted')));
      },
    }, L('guide.notThis')));
  acts.append(h('span', { class: 'spacer' }), feedback);
  return h('article', { class: 'gd-card', dataset: { entry: entry.id } },
    entry.topic ? h('p', { class: 'gd-topic' }, entry.topic,
      entry.lang && entry.lang !== currentLocale() ? h('span', { class: 'gd-lang' }, entry.lang.toUpperCase()) : null) : null,
    h('h3', { class: 'gd-t' }, entry.title, keys.length ? h('span', { class: 'gd-keys' }, ...keys) : null),
    entry.text ? h('p', { class: 'gd-a' }, entry.text) : null,
    learned ? h('p', { class: 'gd-learned' }, L('guide.learned')) : null,
    acts);
}

/**
 * A question that named a passage is answered with the passage: its words in
 * the translation being read, the imported cross-references from it where
 * there are any, and the way there. The words arrive a moment after the card.
 */
export function passageCard(ctx, passage) {
  const { shell } = ctx;
  const name = passageName(shell, passage);
  const words = h('div', { class: 'gd-verses' });
  const links = h('div', { class: 'gd-links' });
  const card = h('article', { class: 'gd-card gd-passage' },
    h('h3', { class: 'gd-t' }, name),
    words,
    links,
    h('div', { class: 'gd-acts' }, h('button', {
      type: 'button', class: 'btn soft gd-do',
      onclick: () => (passage.verse
        ? shell.openVerse(passage.book, passage.chapter, passage.verse)
        : shell.openChapter(passage.book, passage.chapter)),
    }, icon('book-open'), L('guide.goTo', { where: name }))));
  fillPassage(ctx, passage, words, links).catch(() => {});
  return card;
}

/** Verses shown at most; a longer passage, or a chapter, is a press away. */
const VERSES_SHOWN = 4;

async function fillPassage(ctx, passage, words, links) {
  const { shell, state } = ctx;
  const identify = state.get().translation;
  const verses = identify ? await ctx.store.getChapter(identify, passage.book, passage.chapter) : null;
  if (verses) {
    const first = passage.verse ?? 1;
    const last = passage.verse ? (passage.to ?? passage.verse) : Number.POSITIVE_INFINITY;
    const keys = Object.keys(verses).map(Number).filter((n) => n >= first && n <= last).sort((a, b) => a - b);
    const shown = keys.slice(0, VERSES_SHOWN);
    const dir = shell.textDirection?.(identify) ?? 'auto';
    words.replaceChildren(
      ...shown.map((n) => h('p', { class: 'gd-verse', dir },
        h('sup', { class: 'gd-vn' }, shell.workspace.number(n)), ' ', String(verses[n]?.text ?? ''))),
      keys.length > shown.length ? h('p', { class: 'gd-more-v' }, L('guide.moreVerses', { n: keys.length - shown.length })) : null,
      shown.length ? h('p', { class: 'gd-src' }, shell.workspace.primaryName()) : null);
  }
  // Where the reader has imported cross-references, those from this verse.
  if (!passage.verse || !ctx.study) return;
  const found = (await ctx.study.crossrefs(passage.book, passage.chapter))[passage.verse] ?? [];
  if (!found.length) return;
  links.replaceChildren(
    h('span', { class: 'gd-links-l' }, L('sd.type.crossrefs')),
    ...found.slice(0, 6).map(({ ref }) => {
      const [b, c, v, c2, v2] = ref;
      const label = refText(ref, shell.workspace.bookName(b), shell.workspace.number);
      return h('button', {
        type: 'button', class: 'gd-link',
        onclick: () => (v ? shell.openVerse(b, c, v) : shell.openChapter(b, c)),
        title: c2 !== c || v2 !== v ? label : null,
      }, label);
    }));
}

/**
 * Nothing answers: say so, and offer what might — the Bible searched for the
 * words, and the downloadable answers if they are not here yet.
 *
 * @param {{ again?: () => void, help?: boolean }} options `again` asks once
 *        more after a download; `help` offers the Help page (not on the Help
 *        page itself)
 */
export function missCard(ctx, knowledge, question, { again = null, help = true } = {}) {
  const { registry, shell } = ctx;
  const find = registry.verbs().find((verb) => verb.word === 'find');
  return h('article', { class: 'gd-card gd-miss' },
    h('p', { class: 'gd-a' }, L('guide.miss')),
    h('div', { class: 'gd-acts' },
      find ? h('button', {
        type: 'button', class: 'btn soft gd-do', onclick: () => find.run(question),
      }, icon('search'), L('guide.searchBible', { q: question })) : null,
      knowledge.downloaded.topics ? null : h('button', {
        type: 'button', class: 'btn gd-do', onclick: () => knowledge.fetchMore().then(() => again?.()),
      }, icon('download'), L('guide.data.get')),
      help ? h('button', { type: 'button', class: 'btn gd-do', onclick: () => shell.openDoc('help') }, icon('help'), L('doc.help')) : null));
}

/**
 * The answers to one question as a list of cards: the best one whole, the
 * next ones as lines that open into cards.
 */
export function answerBlock(ctx, knowledge, question, { chosen = null, help = true, again = null } = {}) {
  const block = h('section', { class: 'gd-x' }, h('p', { class: 'gd-q' }, question));
  const found = chosen
    ? { passage: null, hits: [{ entry: knowledge.entry(chosen), score: 1, learned: false }].filter((hit) => hit.entry) }
    : knowledge.answer(question);
  if (found.passage) {
    block.append(passageCard(ctx, found.passage));
    return block;
  }
  if (!found.hits.length) {
    block.append(missCard(ctx, knowledge, question, { again, help }));
    return block;
  }
  block.append(answerCard(knowledge, question, found.hits[0]));
  const rest = found.hits.slice(1);
  if (rest.length) {
    block.append(h('div', { class: 'gd-more' },
      h('span', { class: 'gd-more-l' }, L('guide.also')),
      ...rest.map((hit) => h('button', {
        type: 'button', class: 'gd-more-i',
        onclick: (e) => { e.currentTarget.closest('.gd-more').replaceWith(answerCard(knowledge, question, hit)); },
      }, hit.entry.title))));
  }
  return block;
}

/** How many answers have been downloaded, and the button that gets more. */
export function dataLine(knowledge) {
  const has = knowledge.downloaded.topics > 0;
  let said = L('guide.data.none');
  if (knowledge.busy) said = knowledge.progress;
  else if (has) said = L('guide.data.held', { n: knowledge.downloaded.topics, q: knowledge.downloaded.questions });
  return h('div', { class: 'gd-data' },
    h('span', { class: 'gd-more-status' }, said),
    h('button', {
      type: 'button', class: 'gd-data-btn', disabled: knowledge.busy,
      onclick: () => knowledge.fetchMore(),
    }, icon(has ? 'sync' : 'download'), has ? L('guide.data.update') : L('guide.data.get')));
}
