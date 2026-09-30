/**
 * Keeping the app itself current.
 *
 * The two targets update by different means and this feature knows neither of
 * them. The web build holds a new version ready and reloads into it when the
 * reader agrees; the desktop build can only say that a newer release exists and
 * point at it. Both arrive here as platform capabilities — `updates` and
 * `checkUpdate` — and a target that has neither simply gets no command.
 *
 * Nothing is ever taken without being asked for: an update that is ready is
 * offered, never applied, and the automatic check is silent unless it finds
 * something. A check that fails while offline is not news, so it is only
 * reported when the reader asked for it.
 */

import { L, when as dates } from '../../shell/i18n.js';

const KEY = 'updates';
const DAY = 86_400_000;

export default {
  id: 'updates',
  setup(ctx) {
    const { capabilities } = ctx.platform;
    const web = capabilities.updates ?? null;
    const native = capabilities.checkUpdate ?? null;
    const offer = capabilities.install ?? null;
    if (!web && !native && !offer) return;

    const held = ctx.records.get(KEY, null);
    const remember = (patch) => ctx.records.save(KEY, { ...(ctx.records.get(KEY, null) ?? {}), ...patch })
      .catch(() => { /* when the last check ran is not worth a message */ });

    if (web || native) {
      ctx.registry.command({
        id: 'app.checkUpdate',
        title: L('cmd.appUpdate'),
        icon: 'download',
        run: () => check({ quiet: false }),
      });
    }

    if (offer) {
      ctx.registry.command({
        id: 'app.install',
        title: L('cmd.installApp'),
        icon: 'download',
        run: async () => {
          const outcome = await offer.prompt();
          if (outcome === 'unavailable') ctx.shell.notify(offer.installed() ? L('msg.alreadyInstalled') : L('msg.installElsewhere'));
        },
      });
    }

    // A build that is already downloaded and waiting is worth saying so the
    // moment the reader is looking at the app, whoever put it there.
    web?.onReady(() => {
      ctx.shell.notify(L('msg.updateReady'), 'ok', { action: { label: L('cmd.reloadNow'), run: () => web.apply() } });
    });

    ctx.shell.whenReady(() => {
      if (ctx.records.get(KEY, null)?.auto === false) return;
      const last = Number(held?.checkedAt ?? 0);
      if (Date.now() - last < DAY) return;
      check({ quiet: true }).catch(() => { /* reported inside */ });
    });

    // Updating is a setting a reader looks for in settings, so it is there:
    // whether to look on their behalf, when it last looked, and a way to look
    // now without going through the palette.
    if (web || native) {
      ctx.registry.setting({
        id: 'updates.auto',
        section: 'storage',
        order: 20,
        build: (ui) => {
          const record = ctx.records.get(KEY, null) ?? {};
          const when = Number(record.checkedAt ?? 0);
          return [
            ui.toggle({
              name: L('set.autoUpdate'),
              hint: L('set.autoUpdateHint'),
              value: record.auto !== false,
              onChange: (on) => { remember({ auto: on }); },
            }),
            ui.action({
              name: L('cmd.appUpdate'),
              hint: when ? L('set.checkedAt', { when: dates.dateTime(when) }) : L('set.neverChecked'),
              label: L('set.checkNow'),
              glyph: 'download',
              onClick: () => check({ quiet: false }).then(() => ui.refresh()),
            }),
          ];
        },
      });
    }

    /**
     * @param {{ quiet: boolean }} options quiet: say nothing unless there is
     *   something to say — the daily check runs behind the reader's back.
     */
    async function check({ quiet }) {
      try {
        if (web) {
          const waiting = await web.check();
          remember({ checkedAt: Date.now() });
          if (waiting) return; // onReady has already made the offer
          if (!quiet) ctx.shell.notify(L('msg.upToDate'));
          return;
        }
        const { current, latest, url, newer } = await native();
        remember({ checkedAt: Date.now(), latest });
        if (!newer) { if (!quiet) ctx.shell.notify(L('msg.upToDateAt', { version: current })); return; }
        ctx.shell.notify(L('msg.updateAvailable', { version: latest }), 'ok', {
          action: { label: L('cmd.openSource'), run: () => ctx.platform.capabilities.openExternal(url) },
        });
      } catch (err) {
        if (!quiet) ctx.shell.notify(L('msg.updateFailed', { why: err.message }), 'error');
      }
    }
  },
};
