/**
 * Reference: the Bible dictionaries and topical indexes the reader imported
 * (Library → Study data), as a pane in the right sidebar.
 *
 *   Dictionary   a word, looked up; its article, with its verses as links
 *   Topics       the subjects the chapter being read is filed under, or a
 *                subject searched for; each with its verses
 *
 * It opens from the palette ("define grace", "topic prayer"), from the word
 * study when a dictionary has an article for the word, and as a pane. Its
 * code loads the first time it is shown.
 */

import { L } from '../../shell/i18n.js';

export default {
  id: 'reference',
  setup(ctx) {
    const { registry, shell } = ctx;
    if (!ctx.study) return;
    /** What to show next, held until the pane is mounted to show it. */
    let wanted = null;
    let live = null;

    const show = (target) => {
      wanted = target;
      shell.selectPane('right', 'reference');
      if (live) live.show(target);
    };

    registry.pane({
      id: 'reference',
      side: 'right',
      order: 86,
      icon: 'book-open',
      title: L('rf.title'),
      startsHidden: true,
      mount(el) {
        let disposed = false;
        let dispose = null;
        import('./pane.js').then(({ mountReference }) => {
          if (disposed) return;
          const pane = mountReference(el, ctx);
          live = pane;
          dispose = pane.dispose;
          pane.show(wanted);
        }).catch((err) => {
          el.textContent = L('rf.failed', { why: err.message });
        });
        return () => { disposed = true; live = null; dispose?.(); };
      },
    });

    registry.verb({
      id: 'reference.define', word: 'define', takes: 'text', icon: 'book-open',
      title: L('rf.verbDefine'), hint: L('rf.verbDefineHint'),
      run: (text) => show({ mode: 'dictionary', query: String(text ?? '').trim(), open: true }),
    });
    registry.verb({
      id: 'reference.topic', word: 'topic', takes: 'text', icon: 'tag',
      title: L('rf.verbTopic'), hint: L('rf.verbTopicHint'),
      run: (text) => show({ mode: 'topics', query: String(text ?? '').trim(), open: true }),
    });
  },
};
