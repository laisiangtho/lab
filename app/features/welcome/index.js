/**
 * The first run: what this is, and the three things worth knowing before the
 * reader is left alone with it — then, once there is something to read, a
 * short walkthrough of the screen.
 *
 * An app with this many panes, panels and keys can be read as either simple or
 * impenetrable depending on the first ninety seconds. The welcome is one
 * screen, shown once, with buttons that do the thing rather than describe it.
 * The walkthrough (tour.js) comes after, not before: until a translation is
 * installed there is no reading to point at. It starts on its own once, for a
 * reader on their first run, and nothing depends on it — every step names a
 * thing that has its own button, key or menu. It can be skipped at any step,
 * taken again from Welcome, the app menu, the palette or the Guide, and kept
 * from starting on its own in Settings → Study.
 */

import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';
import { runTour } from './tour.js';

const KEY = 'welcome';
const TOUR_KEY = 'tour';

/**
 * The walkthrough's steps, in the order the eye meets them. A step whose
 * target is not on screen is passed over: a phone has no ribbon, and shows
 * its own bar instead.
 */
const STEPS = Object.freeze([
  { id: 'hello', target: null },
  { id: 'reading', target: '.leaf[data-role="primary"] .chapter' },
  { id: 'verse', target: '.leaf[data-role="primary"] .vnum' },
  { id: 'passage', target: '.leaf[data-role="primary"] .crumbs, .ph-where' },
  { id: 'tabs', target: '.tabbar .tabstrip' },
  { id: 'ribbon', target: '.ribbon .rib-rail' },
  { id: 'phone', target: '.mobile-bar, .ph-tabs' },
  { id: 'left', target: '#side-left' },
  { id: 'right', target: '#side-right' },
  { id: 'status', target: '.statusbar' },
  { id: 'menu', target: '.rib-menu' },
  { id: 'ask', target: null },
]);

export default {
  id: 'welcome',
  setup(ctx) {
    const { records, registry, shell } = ctx;

    const seen = () => records.get(KEY, null)?.seen === true;
    const remember = () => records.save(KEY, { seen: true, at: new Date().toISOString() })
      .catch(() => { /* being shown twice is not worth a message */ });

    // --- the walkthrough ---------------------------------------------------

    let tour = null;
    const steps = () => STEPS.map((step) => ({
      ...step, title: L(`tour.${step.id}.t`), body: L(`tour.${step.id}.b`),
      // The phone's bar slides away while reading; the step about it brings it back.
      ...(step.id === 'phone' ? { before: () => shell.phone?.showBar() } : {}),
    }));
    function takeTour() {
      if (tour) return;
      tour = runTour(steps(), {
        onEnd: (how) => {
          tour = null;
          // Not kept, the tour would start again at the next launch: said, not hidden.
          records.save(TOUR_KEY, { pending: false, how, at: new Date().toISOString() })
            .catch((err) => shell.notify(err.message, 'error'));
        },
      });
    }

    /**
     * Starts on its own once: on a first run (the welcome was shown), when
     * there is a chapter on screen to point at, and not if the reader said
     * not to. An automated browser — the tests, the crawl — is not a new
     * reader, and is left to take the tour when it asks for it.
     */
    let waiting = null;
    function maybeTour() {
      if (tour || records.get(TOUR_KEY, null)?.pending !== true) return;
      if (ctx.settings.get().tour === false || navigator.webdriver) return;
      clearTimeout(waiting);
      waiting = setTimeout(() => {
        const reading = document.querySelector('.leaf[data-role="primary"] .vblock');
        const busy = document.querySelector('.scrim:not([hidden]), .modal-scrim:not([hidden])');
        if (reading && reading.offsetParent && !busy && records.get(TOUR_KEY, null)?.pending === true) takeTour();
      }, 900);
    }

    registry.command({
      id: 'welcome.tour',
      title: L('tour.cmd'),
      icon: 'guide',
      run: () => takeTour(),
    });

    registry.setting({
      id: 'welcome.tour',
      section: 'study',
      order: 95,
      build: (ui) => ui.toggle({
        name: L('tour.set'), hint: L('tour.setHint'),
        value: ctx.settings.get().tour !== false,
        onChange: (on) => ctx.state.set({ tour: on }),
      }),
    });

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
    //
    // A reader with no translation yet is still a new reader, greeted again:
    // the welcome's whole business is the first translation, and a start that
    // comes before one (the interface restarted in a language just chosen)
    // would otherwise open on an empty page.
    const fresh = !seen() || ctx.settings.get().translation === null;
    const greeting = fresh && shell.claimFirstRun();
    shell.whenReady(() => {
      if (greeting) {
        shell.openDoc('welcome');
        remember();
        records.save(TOUR_KEY, { pending: true, at: new Date().toISOString() })
          .catch((err) => shell.notify(err.message, 'error'));
      }
      ctx.state.subscribe(maybeTour);
      ctx.library.on('change', maybeTour);
      maybeTour();
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
            link(L('tour.cmd'), () => takeTour()),
            link(L('doc.help'), () => shell.openDoc('help')),
            has('help.formats') ? link(L('doc.formats'), () => shell.openDoc('formats')) : null)));
      },
    });
  },
};
