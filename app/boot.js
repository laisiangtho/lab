/**
 * Application entry shared by every target.
 *
 * A target composes its build and calls start():
 *   start({ root, createPlatform, features: [library, settings, ...], config: {...} })
 *
 * Shared code never asks which target it runs in; everything that varies
 * arrives here as the platform, the feature list, the config, or the target's
 * theme stylesheet.
 *
 * Reading — tabs, panes, the chapter surface — is the shell itself. Features
 * add documents (Library, Settings), sidebar panes and commands around it.
 */

import { resolveConfig } from './config.js';
import { parseCategory } from './core/category.js';
import { defaultSettings } from './core/settings.js';
import { checkFeatures, createRegistry, createState } from './registry.js';
import { loadAliases } from './services/aliases.js';
import { createAnnotations } from './services/annotations.js';
import { createLibrary, fetchJson } from './services/library.js';
import { createLangPacks } from './services/langpacks.js';
import { createLexicons } from './services/lexicon.js';
import { createLemmas } from './services/lemmas.js';
import { createStudyData } from './services/studydata.js';
import { createRecords } from './services/records.js';
import { createSearch } from './services/search.js';
import { createSettings } from './services/settings.js';
import { openStore, resetStore } from './services/store.js';
import { createShell } from './shell/shell.js';
import { h } from './shell/dom.js';
import { L, resolveLocale, setLocale } from './shell/i18n.js';

import './styles/shell.css';
import './styles/views.css';
import './styles/phone.css';

export async function start({ root, createPlatform, features, config }) {
  // The device's language from the first moment, so even the screen of last
  // resort speaks it; the reader's own choice replaces it once settings load.
  setLocale(resolveLocale(null, globalThis.navigator?.languages ?? []));
  try {
    if (!(root instanceof HTMLElement)) throw new Error('boot: root element not found');
    const platform = createPlatform();
    await boot({ root, platform, features, config });
  } catch (err) {
    renderFatal(root, err);
    throw err;
  }
}

/** Replaced by the shell's own notifier once there is a shell to tell. */
let reportLost = () => {};

async function boot({ root, platform, features, config: overrides }) {
  const config = resolveConfig(overrides);
  checkFeatures(features, platform);

  const categoryRaw = await fetchJson(config.categoryUrl, 'category.json');
  const category = parseCategory(categoryRaw);
  // Storage can be taken away mid-session — another window upgrading it, or the
  // browser reclaiming space. Nothing written after that would land, so the
  // reader is told once rather than watching every later action fail quietly.
  let lost = null;
  const store = await openStore({ onLost: (reason) => { lost = reason; reportLost(reason); } });
  const library = createLibrary({ store, categoryRaw, config });
  await library.load();

  const settings = await createSettings({ store, category });
  // Before any feature registers: command titles and pane names are read once.
  setLocale(resolveLocale(settings.get().locale, globalThis.navigator?.languages ?? []));
  const annotations = await createAnnotations({ store, category });
  const records = await createRecords({ store });
  const lexicons = createLexicons({ store, config });
  const registry = createRegistry();
  // Persisted settings seed the session; later changes flow back into them.
  const state = createState({ ...settings.get() });
  const aliasCache = new Map();

  // The shell needs the context, and features reach the shell through it, so
  // the object is built first and the shell added before anything runs.
  const ctx = {
    platform,
    config,
    category,
    store,
    library,
    settings,
    annotations,
    records,
    langPacks: createLangPacks({ records, config }),
    lexicons,
    lemmas: createLemmas({ store }),
    study: createStudyData({ store, library }),
    /**
     * What one feature lends another, by name — the guide's knowledge, which
     * the Help page asks too. The context is frozen; this one object is not,
     * so a feature can offer something without the context changing shape.
     */
    provided: {},
    search: createSearch(),
    state,
    registry,
    /** Alias overlay for a translation (cached). */
    aliases(identify) {
      if (!aliasCache.has(identify)) aliasCache.set(identify, loadAliases(identify, category));
      return aliasCache.get(identify);
    },
  };
  ctx.shell = createShell(root, ctx);
  Object.freeze(ctx);

  // One feature failing to register is not a reason for the reader to lose the
  // text. The ones that did register carry on, and the failure is named.
  const broken = [];
  for (const feature of features) {
    try {
      feature.setup(ctx);
    } catch (err) {
      broken.push(`${feature.id}: ${err.message}`);
    }
  }

  settings.onError((err) => ctx.shell.notify(L('msg.settingsNotSaved', { why: err.message }), 'error'));
  // Only the persisted subset travels back into settings; the shell may keep
  // other state (selections, filters) that is not worth remembering.
  const persisted = Object.keys(defaultSettings);
  state.subscribe((value) => {
    try {
      settings.set(Object.fromEntries(persisted.map((k) => [k, value[k]])));
    } catch (err) {
      ctx.shell.notify(L('msg.settingsNotSaved', { why: err.message }), 'error');
    }
  });

  ctx.shell.start();
  for (const note of settings.notes) ctx.shell.notify(note);
  for (const note of broken) ctx.shell.notify(L('msg.featureBroken', { what: note }), 'error');
  if (lost) ctx.shell.notify(lost, 'error');
  reportLost = (reason) => ctx.shell.notify(L('msg.storageLost', { why: reason }), 'error');

  // Whatever lexicon this device already holds, read once so a Strong's number
  // pressed in the first minute answers without a round trip.
  lexicons.load().catch(() => { /* a lexicon is an extra, never a start-up failure */ });

  // The catalog is checked on every start, but only a change is worth saying:
  // "unchanged" is the answer almost every time, and nobody asked.
  library.checkForUpdates().then(
    ({ changed }) => { if (changed) ctx.shell.notify(L('lib.catalogChanged')); },
    (err) => ctx.shell.notify(L('lib.catalogFailed', { why: err.message }), 'error'),
  );
}

/**
 * The screen of last resort. It has no shell behind it, so it uses nothing but
 * the DOM — and it offers the two things that actually recover a start-up
 * failure: try again, and throw away what is stored.
 *
 * Erasing is behind a second press. It takes the reader's notes and bookmarks
 * with it, so it is never one stray click away.
 */
function renderFatal(root, err) {
  const target = root instanceof HTMLElement ? root : document.body;
  const message = err?.message ?? String(err);
  const erase = h('button', { class: 'btn' }, L('fatal.erase'));
  let armed = false;
  erase.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      erase.classList.add('is-armed');
      erase.textContent = L('fatal.eraseArmed');
      return;
    }
    erase.disabled = true;
    try {
      await resetStore();
      location.reload();
    } catch (e) {
      erase.disabled = false;
      erase.textContent = e.message;
    }
  });

  target.replaceChildren(h('div', { class: 'fatal', role: 'alert' },
    h('h1', {}, L('fatal.title')),
    h('pre', {}, message),
    h('div', { class: 'fatal-acts' },
      h('button', { class: 'btn primary', onclick: () => location.reload() }, L('fatal.retry')),
      erase),
    h('p', { class: 'fatal-note' }, L('fatal.note'))));
}
