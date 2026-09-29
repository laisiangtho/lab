/**
 * The first run: what this is, and the three things worth knowing before the
 * reader is left alone with it.
 *
 * An app with this many panes, panels and keys can be read as either simple or
 * impenetrable depending on the first ninety seconds. What it cannot afford is
 * a tour: nobody reads one, and anything hidden behind a tour is hidden. So
 * this is one screen, shown once, with buttons that do the thing rather than
 * describe it — and it is in Help afterwards, because "where was that screen
 * that explained it" is a real question.
 *
 * It is offered, never forced: it opens beside the Library rather than instead
 * of it, and a reader who came here to read is one press away from reading.
 */

import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const KEY = 'welcome';

export default {
  id: 'welcome',
  setup(ctx) {
    const { records, registry, shell } = ctx;

    const seen = () => records.get(KEY, null)?.seen === true;
    const remember = () => records.save(KEY, { seen: true, at: new Date().toISOString() })
      .catch(() => { /* being shown twice is not worth a message */ });

    registry.command({
      id: 'welcome.open',
      title: L('doc.welcome'),
      icon: 'spark',
      opens: 'welcome',
      run: () => shell.openDoc('welcome'),
    });

    // Claimed here, while features are being set up, rather than when the app
    // has finished starting: the Library asks the same question a moment later,
    // and the answer must not depend on which of them finishes first.
    const greeting = !seen() && shell.claimFirstRun();
    shell.whenReady(() => {
      if (!greeting) return;
      shell.openDoc('welcome');
      remember();
    });

    registry.doc({
      id: 'welcome',
      title: L('doc.welcome'),
      icon: 'spark',
      /**
       * One column, in the middle, with one thing to press.
       *
       * The first version was four bordered panels, each with a heading, a
       * paragraph and a button of its own — a page that looks like work to get
       * through, and which asks a reader who has nothing installed to choose
       * between four places to go. Only one of them can be first: without a
       * translation there is nothing to search, note or read. So the page makes
       * that the only button, and the three things worth knowing sit under it
       * as facts rather than tasks — a line each, no buttons, nothing to
       * finish. What is left of the rest is a quiet row of links at the foot.
       */
      mount(el) {
        const fact = (glyph, text) => h('li', {},
          h('span', { class: 'wl-mark' }, icon(glyph)),
          h('span', {}, text));

        const has = (id) => registry.commands().some((c) => c.id === id);
        const link = (label, run) => h('button', { class: 'wl-link', onclick: run }, label);

        el.classList.add('wl-wrap');
        el.append(h('div', { class: 'wl' },
          h('div', { class: 'wl-badge' }, h('img', { src: './icons/icon.svg', alt: '', width: 40, height: 40 })),
          h('h1', {}, L('doc.welcome.title')),
          h('p', { class: 'wl-lede' }, L('doc.welcome.lede')),

          h('button', { class: 'btn primary wl-go', onclick: () => shell.openDoc('library') },
            icon('library'), L('wl.start')),

          h('ul', { class: 'wl-facts' },
            fact('download', L('wl.oneBody')),
            fact('cmd', L('wl.twoBody')),
            fact('note', L('wl.threeBody'))),

          h('div', { class: 'wl-more' },
            link(L('doc.help'), () => shell.openDoc('help')),
            has('help.formats') ? link(L('doc.formats'), () => shell.openDoc('formats')) : null)));
      },
    });
  },
};
