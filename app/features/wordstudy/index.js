/**
 * Word study: one Strong's number, as far as what is on this device can take
 * it.
 *
 *   the original   the Hebrew or Greek word in the same verse, from an
 *                  original-language text the reader brought, with its
 *                  morphology spelled out
 *   the lexicon    what the number means, from whichever lexicon is held
 *   this text      every word the translation uses for the number, how often,
 *                  and in which verses — the "same meaning, said how" that a
 *                  concordance of the translation alone cannot give
 *
 * It opens from a pressed word's popover, from the palette ("study H430"),
 * and as a pane in the right sidebar. Its code, and the 190 KB of morphology
 * tables, load the first time it is shown.
 */

import { L } from '../../shell/i18n.js';

export default {
  id: 'wordstudy',
  setup(ctx) {
    const { registry, shell, state } = ctx;
    /** What to study next, held until the pane is mounted to show it. */
    let wanted = null;
    let live = null;

    const study = (target) => {
      wanted = target;
      shell.selectPane('right', 'study');
      if (live) live.show(target);
    };
    shell.offerWordStudy(study);

    registry.pane({
      id: 'study',
      side: 'right',
      order: 85,
      icon: 'study',
      title: L('ws.title'),
      startsHidden: true,
      mount(el) {
        let disposed = false;
        let dispose = null;
        import('./pane.js').then(({ mountStudy }) => {
          if (disposed) return;
          const pane = mountStudy(el, ctx);
          live = pane;
          dispose = pane.dispose;
          pane.show(wanted);
        }).catch((err) => {
          el.textContent = L('ws.failed', { why: err.message });
        });
        return () => { disposed = true; live = null; dispose?.(); };
      },
    });

    registry.verb({
      id: 'study.verb',
      word: 'study',
      takes: 'text',
      icon: 'study',
      title: L('ws.verb'),
      hint: L('ws.verbHint'),
      run: (text) => {
        const code = /^\s*([HG])0*(\d{1,5})([a-z]?)\s*$/i.exec(String(text ?? ''));
        if (!code) { shell.notify(L('ws.notANumber', { text: String(text ?? '').trim() }), 'error'); return; }
        const { translation, book, chapter } = state.get();
        study({ code: `${code[1].toUpperCase()}${code[2]}${code[3].toUpperCase()}`, identify: translation, book, chapter, verse: null });
      },
    });

    // The pane's own command ("Show Word study pane") opens it; a second
    // command doing the same under another name would be two rows for one
    // thing in the palette.
  },
};
