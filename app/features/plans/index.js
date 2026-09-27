/**
 * Reading plans and the verse of the day, as Phase 1 had them: a pane that
 * offers a verse to read now, a way back to where reading stopped, and — once
 * a plan is running — today's chapters and whatever is behind.
 *
 * The schedule itself is derived in core/plans.js; this is only its surface.
 */

import { chapterKey, dailyVerse, localDate, parseChapterKey, planChapters, planState, PLANS } from '../../core/plans.js';
import { h } from '../../shell/dom.js';
import { wantsNewTab } from '../../shell/reflink.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const KEY = 'plan';

export default {
  id: 'plans',
  setup(ctx) {
    const { category, records, registry, shell, state, store } = ctx;

    const record = () => records.get(KEY, null);
    const current = () => planState(record(), category);

    async function start(id) {
      await records.save(KEY, { id, start: localDate(), read: {} });
      shell.notify(L('msg.planStarted', { plan: L(`plan.${id}`) }));
    }

    async function stop() {
      await records.save(KEY, null);
      shell.notify(L('msg.planStopped'));
    }

    async function setRead(key, on) {
      const held = record();
      const st = current();
      if (!held || !st || !st.keys.includes(key)) return;
      const read = { ...st.read };
      if (on) read[key] = Date.now();
      else delete read[key];
      await records.save(KEY, { ...held, read });
    }

    /** The chapter in view, marked read — only when the plan covers it. */
    async function markCurrent() {
      const { book, chapter } = state.get();
      const key = chapterKey(book, chapter);
      const st = current();
      if (!st) { shell.notify(L('msg.noPlan'), 'error'); return; }
      if (!st.keys.includes(key)) { shell.notify(L('msg.notInPlan', { ref: `${shell.workspace.bookName(book)} ${chapter}` }), 'error'); return; }
      await setRead(key, !st.read[key]);
      shell.notify(st.read[key]
        ? L('msg.unread', { ref: `${shell.workspace.bookName(book)} ${chapter}` })
        : L('msg.read', { ref: `${shell.workspace.bookName(book)} ${chapter}` }));
    }

    registry.command({ id: 'plan.markRead', title: L('cmd.markRead'), icon: 'check', needsChapter: true, run: markCurrent });
    registry.command({ id: 'plan.open', title: L('pane.plan'), icon: 'calendar', run: () => shell.selectPane('left', 'plan') });

    registry.pane({
      id: 'plan',
      side: 'left',
      order: 30,
      icon: 'calendar',
      title: L('pane.plan'),
      mount(el) {
        const body = h('div', { class: 'stack' });
        el.append(body);
        let token = 0;

        const ref = (book, chapter, verse) => (verse
          ? `${shell.workspace.bookName(book)} ${chapter}:${verse}`
          : `${shell.workspace.bookName(book)} ${chapter}`);

        function chip(key, st) {
          const p = parseChapterKey(key);
          const read = Boolean(st.read[key]);
          const open = state.get();
          const isOpen = open.book === p.book && open.chapter === p.chapter;
          return h('span', { class: `plan-ch${read ? ' is-read' : ''}${isOpen ? ' is-open' : ''}` },
            h('button', { class: 'pc-open', onclick: (e) => shell.openChapter(p.book, p.chapter, { newTab: wantsNewTab(e) }) }, ref(p.book, p.chapter)),
            h('button', {
              class: 'pc-tick',
              'aria-pressed': String(read),
              title: L(read ? 'cmd.markUnread' : 'cmd.markRead'),
              onclick: () => setRead(key, !read).catch((err) => shell.notify(err.message, 'error')),
            }, icon('check')));
        }

        async function dailyCard() {
          const { translation } = state.get();
          const daily = dailyVerse();
          const verses = translation ? await store.getChapter(translation, daily.book, daily.chapter) : null;
          const text = verses?.[daily.verse]?.text ?? '';
          return h('div', { class: 'card plan-daily' },
            h('div', { class: 'plan-label' }, L('plan.daily')),
            text ? h('p', { class: 'pd-text', dir: 'auto' }, text) : null,
            h('button', {
              class: 'pd-ref',
              onclick: (e) => shell.openVerse(daily.book, daily.chapter, daily.verse, { newTab: wantsNewTab(e) }),
            }, ref(daily.book, daily.chapter, daily.verse), icon('chev')));
        }

        function planCard(st) {
          const pct = Math.floor(st.done / st.total * 100);
          const parts = [
            h('div', { class: 'plan-top' },
              h('b', {}, L(`plan.${st.def.id}`)),
              h('span', {}, L('plan.day', { n: Math.min(st.day + 1, st.def.days), total: st.def.days }))),
            h('div', { class: 'plan-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
              h('i', { style: { width: `${pct}%` } })),
            h('div', { class: 'plan-meta' }, L('lbl.progress', { pct, read: st.done, total: st.total })),
          ];

          if (st.finished) {
            parts.push(h('p', { class: 'plan-note' }, L('plan.finished')));
          } else {
            if (st.today.length) {
              parts.push(h('div', { class: 'plan-label' }, L('plan.today')));
              parts.push(h('div', { class: 'plan-chips' }, st.today.map((k) => chip(k, st))));
              if (st.today.every((k) => st.read[k])) parts.push(h('p', { class: 'plan-note' }, L('plan.done')));
            }
            if (st.behind.length) {
              parts.push(h('div', { class: 'plan-label is-behind' }, L('plan.behind', { n: st.behind.length })));
              parts.push(h('div', { class: 'plan-chips' }, st.behind.slice(0, 12).map((k) => chip(k, st))));
            }
          }
          parts.push(h('button', { class: 'plan-stop', onclick: () => stop().catch((err) => shell.notify(err.message, 'error')) }, L('plan.stop')));
          return h('div', { class: 'card plan-card' }, parts);
        }

        function picker() {
          return [
            h('div', { class: 'plan-label plan-gap' }, L('plan.choose')),
            ...PLANS.map((p) => h('button', {
              class: 'plan-pick',
              onclick: () => start(p.id).catch((err) => shell.notify(err.message, 'error')),
            },
              h('b', {}, L(`plan.${p.id}`)),
              h('span', {}, `${L('lbl.chapters', { n: planChapters(category, p).length })} · ${L('lbl.days', { n: p.days })}`))),
          ];
        }

        async function paint() {
          const run = ++token;
          const daily = await dailyCard();
          if (run !== token) return;
          const { book, chapter } = state.get();
          const st = current();
          body.replaceChildren(
            daily,
            h('button', {
              class: 'plan-continue',
              onclick: (e) => shell.openChapter(book, chapter, { newTab: wantsNewTab(e) }),
            }, icon('book-open'), h('span', {}, L('plan.continue')), h('b', {}, ref(book, chapter))),
            ...(st ? [planCard(st)] : picker()));
        }

        const run = () => paint().catch((err) => shell.notify(err.message, 'error'));
        const offRecords = records.on('change', run);
        const offState = state.subscribe(run);
        // A plan's day turns over while the app is open, or asleep in a tab.
        const onVisible = () => { if (!document.hidden) run(); };
        document.addEventListener('visibilitychange', onVisible);
        run();
        return () => { offRecords(); offState(); document.removeEventListener('visibilitychange', onVisible); };
      },
    });
  },
};
