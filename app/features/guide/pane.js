/**
 * The Guide pane: the knowledge (knowledge.js) as a conversation in a
 * sidebar. One field at the foot, the exchange above it; each answer is the
 * card Help draws (cards.js), so "how do I bookmark a verse" is answered by
 * the app doing it, not by a paragraph about where the button is.
 */

import { fill, h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { answerBlock, dataLine } from './cards.js';

export function mountGuide(el, ctx, { knowledge }) {
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
    fill(log, h('div', { class: 'gd-hello' },
      h('span', { class: 'gd-hello-mark' }, icon('guide')),
      h('p', { class: 'gd-hello-t' }, L('guide.hello')),
      h('p', { class: 'gd-hello-s' }, L('guide.helloSub')),
      h('div', { class: 'gd-starters' }, knowledge.starters().map((entry) => h('button', {
        type: 'button', class: 'gd-starter',
        onclick: () => answer(entry.title, entry.id),
      }, entry.title))),
      dataLine(knowledge)));
  }

  /**
   * Answer a question. `chosen` is the entry a starter button stands for:
   * pressing "Getting started" means that topic, whatever else its words find.
   */
  function answer(question, chosen = null) {
    if (!exchanges) fill(log);
    exchanges += 1;
    clear.hidden = false;
    const block = answerBlock(ctx, knowledge, question, { chosen, again: () => answer(question) });
    log.append(block);
    block.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  // Downloaded answers arriving, or a download starting or ending, change
  // the greeting; once a question has been asked it stays as it is.
  const off = knowledge.on('change', () => { if (!exchanges) paintHello(); });

  return {
    ask: (question) => { answer(question); },
    dispose: () => off(),
  };
}
