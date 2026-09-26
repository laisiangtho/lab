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
      mount(el) {
        const step = (glyph, title, body, label, run) => h('section', { class: 'wl-step' },
          h('span', { class: 'wl-mark' }, icon(glyph)),
          h('div', { class: 'wl-text' },
            h('h2', {}, title),
            h('p', {}, body)),
          label ? h('button', { class: 'btn', onclick: run }, label) : null);

        const has = (id) => registry.commands().some((c) => c.id === id);

        el.classList.add('wl-wrap');
        el.append(h('div', { class: 'wl' },
          h('h1', {}, L('doc.welcome.title')),
          h('p', { class: 'wl-lede' }, L('doc.welcome.lede')),

          h('div', { class: 'wl-steps' },
            step('library', L('wl.oneTitle'), L('wl.oneBody'), L('doc.library'), () => shell.openDoc('library')),
            step('cmd', L('wl.twoTitle'), L('wl.twoBody'), L('cmd.palette'), () => shell.run('shell.palette')),
            step('note', L('wl.threeTitle'), L('wl.threeBody'), null, null),
            has('help.formats')
              ? step('db', L('wl.fourTitle'), L('wl.fourBody'), L('doc.formats'), () => shell.openDoc('formats'))
              : null),

          h('div', { class: 'wl-acts' },
            h('button', { class: 'btn primary', onclick: () => shell.openDoc('library') },
              icon('library'), L('wl.start')),
            h('button', { class: 'btn', onclick: () => shell.openDoc('help') }, icon('help'), L('doc.help'))),
          h('p', { class: 'wl-note muted' }, L('wl.note'))));
      },
    });
  },
};
