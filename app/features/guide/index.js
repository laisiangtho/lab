/**
 * The guide: a pane that answers "how do I…" from what the app already knows
 * about itself, and offers the button that does it.
 *
 * It starts switched off (`startsHidden`) and is not built until it is asked
 * for — from its command, from `ask …` or `? …` in the palette, or from Help.
 * Everything it needs beyond this file is loaded then (`pane.js`, and the
 * matching in `core/guide.js`), so a reader who never opens it downloads none
 * of it.
 *
 * What it answers from, all in the interface's language: topics written for
 * it (`guide.t.*`), every command and palette verb registered in this build,
 * every document, and every setting with its sentence. So a build with fewer
 * features has a guide that knows fewer things, and never one that offers a
 * button that is not there.
 *
 * What it has learned is the feature record `guide` (see `core/guide.js`),
 * kept on this device, carried by the settings export, and forgotten from
 * Settings → Study.
 */

import { createGuideData } from '../../services/guidedata.js';
import { L } from '../../shell/i18n.js';

export const GUIDE_KEY = 'guide';

export default {
  id: 'guide',
  setup(ctx) {
    const { registry, records, shell } = ctx;
    const guideData = createGuideData({ store: ctx.store, config: ctx.config });
    /** The mounted pane's `ask`, once there is one; questions wait for it. */
    let live = null;
    const waiting = [];

    // One knowledge for every view that asks it, loaded the first time one
    // does (or soon after startup, so "?" in the palette has answers to show).
    let loading = null;
    let knowledge = null;
    const load = () => (loading ??= import('./knowledge.js').then(({ createKnowledge }) => {
      knowledge = createKnowledge(ctx, { guideData });
      return knowledge;
    }));
    ctx.provided.guide = { load, get loaded() { return knowledge; } };
    shell.whenReady?.(() => {
      const soon = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500));
      soon(() => { load().catch(() => {}); });
    });

    const openWith = (question) => {
      if (question) waiting.push(question);
      shell.selectPane('right', 'guide');
      if (live) while (waiting.length) live.ask(waiting.shift());
    };

    registry.pane({
      id: 'guide',
      side: 'right',
      order: 90,
      icon: 'guide',
      title: L('pane.guide'),
      startsHidden: true,
      mount(el) {
        let disposed = false;
        let dispose = null;
        el.classList.add('guide-host');
        Promise.all([import('./pane.js'), load()]).then(([{ mountGuide }, known]) => {
          if (disposed) return;
          const pane = mountGuide(el, ctx, { knowledge: known });
          dispose = pane.dispose;
          live = pane;
          while (waiting.length) pane.ask(waiting.shift());
        }).catch((err) => {
          el.textContent = L('guide.failed', { why: err.message });
        });
        return () => { disposed = true; live = null; dispose?.(); };
      },
    });

    registry.verb({
      id: 'guide.ask',
      word: 'ask',
      takes: 'text',
      icon: 'guide',
      title: L('guide.verb'),
      hint: L('guide.verbHint'),
      run: (text) => openWith(text),
      // The palette's view of the knowledge: the best answers, as rows to
      // press. Until the knowledge has loaded there is only the question.
      suggest: (text) => {
        if (!knowledge) { load().then(() => shell.refreshPalette?.()).catch(() => {}); return []; }
        const found = knowledge.answer(text, { limit: 4 });
        if (found.passage) return [];
        return found.hits.map(({ entry }) => {
          const action = knowledge.runnable(entry.does);
          return {
            id: `guide.${entry.id}`,
            title: entry.title,
            sub: entry.text,
            icon: 'guide',
            run: () => {
              knowledge.remember(text, entry.id, +1);
              if (action) action.run();
              else openWith(text);
            },
          };
        });
      },
    });

    registry.setting({
      id: 'guide.data',
      section: 'study',
      order: 91,
      build: (ui) => ui.action({
        name: L('guide.data.set'),
        hint: L('guide.data.setHint'),
        label: L('guide.data.remove'),
        glyph: 'trash',
        onClick: async () => {
          await guideData.clear();
          shell.notify(L('guide.data.removed'), 'ok');
        },
      }),
    });

    registry.setting({
      id: 'guide.memory',
      section: 'study',
      order: 90,
      build: (ui) => {
        const pairs = Array.isArray(records.get(GUIDE_KEY, null)?.pairs) ? records.get(GUIDE_KEY, null).pairs.length : 0;
        return ui.action({
          name: L('guide.set'),
          hint: pairs ? L('guide.setHint', { n: pairs }) : L('guide.setEmpty'),
          label: L('guide.forget'),
          glyph: 'x',
          disabled: !pairs,
          onClick: async () => {
            const sure = await shell.confirm({
              title: L('guide.forgetTitle'),
              body: L('guide.forgetBody'),
              confirm: L('guide.forget'),
              danger: true,
            });
            if (!sure) return;
            await records.save(GUIDE_KEY, null);
            knowledge?.forget();
            shell.notify(L('guide.forgotten'), 'ok');
            ui.refresh();
          },
        });
      },
    });
  },
};
