/**
 * Feature registry. Pure (no DOM) so it can be tested under node:test.
 *
 * A feature contributes three kinds of thing to the shell:
 *   doc      a workspace tab (Library, Settings, …); chapters are built in
 *   pane     a sidebar pane (Books, Details, …)
 *   command  an entry in the command palette, optionally with a hotkey
 *
 *   export default {
 *     id: 'export-chapter',
 *     requires: ['saveFile'],   // platform capabilities, checked at boot
 *     setup(ctx) { ctx.registry.command({...}); },
 *   };
 */

/**
 * Fail at startup — before any feature runs — when a target lists a feature
 * its platform cannot support.
 */
export function checkFeatures(features, platform) {
  if (!Array.isArray(features) || features.length === 0) throw new Error('boot: features must be a non-empty array');
  if (!platform || typeof platform.id !== 'string' || typeof platform.capabilities !== 'object') {
    throw new Error('boot: platform must be { id, capabilities }');
  }
  const ids = new Set();
  for (const [i, f] of features.entries()) {
    if (!f || typeof f.id !== 'string' || typeof f.setup !== 'function') {
      throw new Error(`boot: features[${i}] is not a feature module (expected { id, setup })`);
    }
    if (ids.has(f.id)) throw new Error(`boot: feature "${f.id}" is listed twice`);
    ids.add(f.id);
    for (const cap of f.requires ?? []) {
      if (typeof platform.capabilities[cap] !== 'function') {
        throw new Error(`boot: feature "${f.id}" requires platform capability "${cap}", which platform "${platform.id}" does not provide`);
      }
    }
  }
}

import { SETTING_SECTIONS } from './core/settings.js';

const SIDES = new Set(['left', 'right']);

export function createRegistry() {
  const docs = new Map();
  const panes = new Map();
  const commands = new Map();
  const verseActions = new Map();
  const settingRows = new Map();
  const verbs = new Map();

  return {
    /**
     * A workspace tab.
     * @param {{ id: string, title: string, icon?: string, mount(el: HTMLElement): (void | (() => void)) }} d
     */
    doc(d) {
      if (!d?.id || !d.title || typeof d.mount !== 'function') throw new Error('registry.doc: expected { id, title, mount }');
      if (docs.has(d.id)) throw new Error(`registry.doc: duplicate doc id "${d.id}"`);
      docs.set(d.id, Object.freeze({ icon: 'book', ...d }));
    },
    /**
     * A sidebar pane.
     * @param {{ id: string, side: 'left'|'right', title: string, icon?: string, order?: number,
     *           startsHidden?: boolean, mount(el: HTMLElement): (void | (() => void)) }} p
     *        `order` sorts the strip (lower first); features register before the
     *        shell does, so without it the Books pane would land last.
     *        `startsHidden` offers the pane without placing it: it is known, so
     *        it does not arrive on its own, and its command (or `selectPane`)
     *        brings it in. Not mounted until then.
     */
    pane(p) {
      if (!p?.id || !p.title || typeof p.mount !== 'function') throw new Error('registry.pane: expected { id, title, mount }');
      if (!SIDES.has(p.side)) throw new Error(`registry.pane: side must be left or right, got ${JSON.stringify(p.side)}`);
      if (panes.has(p.id)) throw new Error(`registry.pane: duplicate pane id "${p.id}"`);
      panes.set(p.id, Object.freeze({ icon: 'info', order: 100, ...p }));
    },
    /**
     * @param {{ id: string, title: string, run(): unknown, keys?: string, icon?: string,
     *           ribbon?: boolean, bar?: boolean, needsChapter?: boolean,
     *           opens?: string,
     *           state?: () => boolean | { on?: boolean, icon?: string, title?: string, progress?: number } }} c
     *        `opens` names the document this command brings up, and `state`
     *        answers whether what it does is currently on. Either one makes its
     *        button say so rather than looking the same whatever is happening —
     *        a button that opens the Library should be lit while the Library is
     *        the tab in front of the reader.
     *        `state` may also answer with an object, for a command whose state
     *        is a process rather than a switch: `icon` swaps the glyph (a pause
     *        bar while it speaks), `title` says what pressing it would do now,
     *        and `progress` (0…1) draws a ring round the button. A feature
     *        whose state moves on its own calls `shell.refreshCommands()`.
     *        `needsChapter` marks a command that only means something with a
     *        chapter open; the shell shows its button but does not let it be
     *        pressed while a document tab is active.
     *        `ribbon` asks for a button on the rail down the side — a place to
     *        go. `bar` asks for one in the band over the text, beside the tabs —
     *        something done to what is being read. Both are a starting
     *        arrangement: the ribbon is the reader's to rearrange.
     */
    command(c) {
      if (!c?.id || !c.title || typeof c.run !== 'function') throw new Error('registry.command: expected { id, title, run }');
      if (commands.has(c.id)) throw new Error(`registry.command: duplicate command id "${c.id}"`);
      commands.set(c.id, Object.freeze({ ...c }));
    },
    /**
     * A button in the verse bar.
     * @param {{ id: string, title: string|((p: object) => string), icon: string|((p: object) => string),
     *           isOn?: (p: object) => boolean, run(p: {book:number,chapter:number,verse:number}): unknown }} a
     */
    verseAction(a) {
      if (!a?.id || !a.title || !a.icon || typeof a.run !== 'function') throw new Error('registry.verseAction: expected { id, title, icon, run }');
      if (verseActions.has(a.id)) throw new Error(`registry.verseAction: duplicate id "${a.id}"`);
      verseActions.set(a.id, Object.freeze({ ...a }));
    },
    /**
     * A row on the settings page.
     *
     * Settings is the one place a reader looks for what they can change, but
     * most of what they can change belongs to a feature — which pane follows
     * the reading position, what search assumes, whether updates are looked
     * for. So the page owns the layout and the feature owns the setting: it
     * contributes a row and is handed the vocabulary to build it with.
     *
     * @param {{ id: string, section: string, order?: number,
     *           build(ui: object): HTMLElement|HTMLElement[]|null }} s
     */
    setting(s) {
      if (!s?.id || typeof s.build !== 'function') throw new Error('registry.setting: expected { id, section, build }');
      if (!SETTING_SECTIONS.includes(s.section)) {
        throw new Error(`registry.setting: unknown section ${JSON.stringify(s.section)} (expected ${SETTING_SECTIONS.join(', ')})`);
      }
      if (settingRows.has(s.id)) throw new Error(`registry.setting: duplicate setting id "${s.id}"`);
      settingRows.set(s.id, Object.freeze({ order: 100, ...s }));
    },
    /**
     * A word the palette accepts as an instruction, with what follows it as its
     * argument: `note ps 23:1-6`, `mark jn 3:16`, `find mercy`.
     *
     * The palette is already how a reader reaches everything by name; a verb
     * makes it how they reach everything *with something*, without first
     * navigating to the passage and then finding the button. Nothing is hidden
     * behind it: every verb is also an ordinary command or a button somewhere.
     *
     * @param {{ id: string, word: string, title: string, icon?: string,
     *           takes?: 'passage'|'text', hint?: string,
     *           run(argument: object|string): unknown }} v
     *        `takes: 'passage'` (the default) is handed { book, chapter, verse,
     *        to }; with nothing typed after the verb it is the passage on
     *        screen. `takes: 'text'` is handed the rest of the line.
     */
    verb(v) {
      if (!v?.id || !v.word || !v.title || typeof v.run !== 'function') {
        throw new Error('registry.verb: expected { id, word, title, run }');
      }
      if (!/^[a-z][a-z-]*$/.test(v.word)) throw new Error(`registry.verb: word must be lower-case letters, got ${JSON.stringify(v.word)}`);
      if (verbs.has(v.word)) throw new Error(`registry.verb: duplicate word "${v.word}"`);
      verbs.set(v.word, Object.freeze({ icon: 'cmd', takes: 'passage', hint: null, ...v }));
    },
    verbs: () => [...verbs.values()],
    /** The rows a section has gathered, in order. */
    settingRows: (section) => [...settingRows.values()]
      .filter((s) => s.section === section)
      .sort((a, b) => a.order - b.order),
    verseActions: () => [...verseActions.values()],
    hasCommand: (id) => commands.has(id),
    docs: () => [...docs.values()],
    getDoc: (id) => docs.get(id),
    panes: (side) => [...panes.values()].filter((p) => !side || p.side === side).sort((a, b) => a.order - b.order),
    commands: () => [...commands.values()],
  };
}

/** Minimal observable state shared by the shell and features. */
export function createState(initial) {
  let value = Object.freeze({ ...initial });
  const subscribers = new Set();
  return {
    get: () => value,
    set(patch) {
      value = Object.freeze({ ...value, ...patch });
      for (const fn of subscribers) fn(value);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
