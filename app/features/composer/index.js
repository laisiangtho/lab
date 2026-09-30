/**
 * The note composer: a floating window for writing about the passage in view.
 *
 * A window rather than a modal, because preparing a passage means reading and
 * writing at once — it must never block the workspace behind it. Phase 1's
 * markup and its three modes (write, split, preview) are kept, as is its habit
 * of remembering where the window was left.
 *
 * It edits the same notes the Notes pane does: one store, two ways in. The
 * title line is the note's first heading, so a note written here reads the same
 * in the source text.
 */

import { noteTitle, wordCount } from '../../core/markdown.js';
import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L, when } from '../../shell/i18n.js';
import { renderMarkdown } from '../../shell/markdown.js';

const KEY = 'composer';
const MODES = Object.freeze(['write', 'split', 'preview']);
const SAVE_DELAY_MS = 600;
const DEFAULT = Object.freeze({ width: 560, height: 480, mode: 'split', split: 0.5 });
const MIN = Object.freeze({ width: 340, height: 240 });

export default {
  id: 'composer',
  setup(ctx) {
    const { annotations, records, registry, shell, state } = ctx;

    // The composer opens in the mode the reader last used; this is where that
    // can be set without opening it.
    registry.setting({
      id: 'composer.mode',
      section: 'study',
      order: 30,
      build: (ui) => ui.choice({
        name: L('set.composerMode'),
        hint: L('set.composerModeHint'),
        options: MODES.map((id) => [id, L(`val.${id}`)]),
        value: (records.get(KEY, null) ?? {}).mode ?? DEFAULT.mode,
        onChange: (mode) => { setMode(mode); ui.refresh(); },
      }),
    });

    const title = h('input', { class: 'cw-title', dir: 'auto', spellcheck: 'false', placeholder: L('lbl.untitled') });
    const chip = h('span', { class: 'cw-chip' });
    const text = h('textarea', { class: 'scroll', dir: 'auto', spellcheck: 'true', placeholder: L('ph.note') });
    const preview = h('div', { class: 'cw-preview scroll' });
    const meta = h('span', { class: 'cw-meta' });
    const splitter = h('div', { class: 'cw-split', title: L('hint.resizeReset') });
    const modes = MODES.map((mode) => h('button', {
      dataset: { mode },
      title: L(`val.${mode}`),
      onclick: () => setMode(mode),
    }, icon(mode === 'write' ? 'edit' : mode === 'split' ? 'split' : 'eye')));

    const element = h('section', { class: 'composer win-layer', hidden: true, 'data-mode': DEFAULT.mode, 'data-max': '0' },
      h('header', { class: 'cw-bar' },
        h('span', { class: 'cw-mark' }, icon('note')),
        title,
        chip,
        h('div', { class: 'cw-seg' }, modes),
        h('button', { class: 'cw-tool', title: L('cmd.maximise'), onclick: toggleMax }, icon('maxsq')),
        h('button', { class: 'cw-tool danger', title: L('cmd.close'), onclick: close }, icon('x'))),
      h('div', { class: 'cw-body' },
        h('div', { class: 'cw-write' }, text),
        splitter,
        preview,
        meta),
      ...['e', 's', 'se'].map((dir) => h('div', { class: 'cw-resize', dataset: { dir } })));

    let editing = null;          // the note being written, once it exists
    let target = null;           // { book, chapter, verse }
    let timer = null;

    const held = () => ({ ...DEFAULT, ...(records.get(KEY, null) ?? {}) });
    const remember = (patch) => records.save(KEY, { ...held(), ...patch }).catch((err) => shell.notify(err.message, 'error'));

    document.body.append(element);
    place();
    wireDrag();
    wireResize();
    wireSplit();

    registry.command({ id: 'composer.open', title: L('cmd.composer'), icon: 'note', ribbon: true, keys: 'Mod+j', run: () => open() });
    registry.command({ id: 'composer.mode', title: L('cmd.composerMode'), icon: 'split', run: cycleMode });
    registry.verb({
      id: 'composer.note',
      word: 'note',
      title: L('verb.note'),
      icon: 'note',
      hint: L('verb.noteHint'),
      run: (passage) => open(passage),
    });
    registry.verseAction({
      id: 'composer.verse',
      title: L('cmd.compose'),
      icon: 'edit',
      run: (p) => open(p),
    });

    /** Position and size from what was remembered, clamped into this window. */
    function place() {
      const rect = held();
      const width = Math.min(Math.max(rect.width, MIN.width), window.innerWidth - 24);
      const height = Math.min(Math.max(rect.height, MIN.height), window.innerHeight - 24);
      const left = Math.min(Math.max(rect.left ?? (window.innerWidth - width - 28), 0), Math.max(window.innerWidth - width, 0));
      const top = Math.min(Math.max(rect.top ?? 84, 0), Math.max(window.innerHeight - height, 0));
      Object.assign(element.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      element.dataset.mode = MODES.includes(rect.mode) ? rect.mode : DEFAULT.mode;
      text.parentElement.style.flex = `${rect.split ?? DEFAULT.split}`;
      preview.style.flex = `${1 - (rect.split ?? DEFAULT.split)}`;
    }

    function open(passage, { focus = true } = {}) {
      const { book, chapter } = state.get();
      const wanted = passage ?? (target && target.book === book && target.chapter === chapter ? target : { book, chapter, verse: null });
      target = wanted;
      editing = annotations.forChapter(target.book, target.chapter).notes.find((n) => n.verse === (target.verse ?? null)) ?? null;
      text.value = editing?.text ?? '';
      element.hidden = false;
      place();
      // Preview alone has nowhere to type: a note with nothing in it yet opens
      // where it can be written, whatever view was used last. The reader's
      // choice is not changed, only this opening of it.
      if (!text.value.trim() && element.dataset.mode === 'preview') element.dataset.mode = window.innerWidth <= 760 ? 'write' : 'split';
      paint();
      if (focus) text.focus();
    }

    function close() {
      save().catch((err) => shell.notify(err.message, 'error'));
      element.hidden = true;
    }

    function cycleMode() {
      setMode(MODES[(MODES.indexOf(element.dataset.mode) + 1) % MODES.length]);
    }

    function setMode(mode) {
      element.dataset.mode = mode;
      remember({ mode });
      paint();
    }

    function toggleMax() {
      element.dataset.max = element.dataset.max === '1' ? '0' : '1';
    }

    const label = () => (target.verse === null
      ? `${shell.workspace.bookName(target.book)} ${target.chapter}`
      : `${shell.workspace.bookName(target.book)} ${target.chapter}:${target.verse}`);

    function paint() {
      if (!target) return;
      chip.textContent = label();
      if (document.activeElement !== title) title.value = noteTitle(text.value, '');
      for (const button of modes) button.classList.toggle('is-on', button.dataset.mode === element.dataset.mode);
      meta.textContent = [
        L('lbl.words', { n: wordCount(text.value) }),
        editing ? L('lbl.savedAt', { time: when.time(editing.updated) }) : L('lbl.unsaved'),
      ].join(' · ');

      if (element.dataset.mode !== 'write') {
        preview.replaceChildren(renderMarkdown(text.value, {
          resolver: shell.workspace.resolver(),
          onLink: (ref, options) => shell.openVerse(ref.book, ref.chapter, ref.verse ?? 1, options),
          onPeek: (ref, anchor) => shell.openPeek(anchor, ref),
          onTag: (tag) => shell.openTag?.(tag),
        }));
      }
    }

    /**
     * Write the note down.
     *
     * The passage is captured before the write and checked after it, because a
     * save is not instantaneous and the composer follows the reading: pressing
     * a link in the composer's own preview blurs the textarea (which saves) and
     * then changes the chapter (which re-points the composer) while that write
     * is still in the database. Without the check the note that came back was
     * filed as the one being edited *in the new chapter*, and the next
     * keystroke rewrote a note about Psalm 23 into a note about Psalm 24 —
     * silently, with the right passage shown above it.
     */
    async function save() {
      if (!target) return;
      const mine = target;
      const body = text.value.trim();
      if (!body) {
        if (editing) await annotations.deleteNote(editing.id);
        if (mine === target) editing = null;
        return;
      }
      const saved = await annotations.saveNote({ id: editing?.id, ...mine, text: body });
      if (mine !== target) return;
      editing = saved;
      paint();
    }

    const queueSave = () => {
      clearTimeout(timer);
      timer = setTimeout(() => save().catch((err) => shell.notify(err.message, 'error')), SAVE_DELAY_MS);
    };

    text.addEventListener('input', () => { paint(); queueSave(); });
    text.addEventListener('blur', () => { clearTimeout(timer); save().catch((err) => shell.notify(err.message, 'error')); });

    // The title line is the note's first heading: editing it rewrites that line.
    title.addEventListener('input', () => {
      const lines = text.value.split('\n');
      const first = lines.findIndex((line) => line.trim());
      const heading = `# ${title.value}`;
      if (first === -1) {
        text.value = `${heading}\n`;
      } else if (/^#{1,4}\s+/.test(lines[first])) {
        lines[first] = heading;
        text.value = lines.join('\n');
      } else {
        text.value = [heading, '', ...lines].join('\n');
      }
      queueSave();
    });

    /**
     * The title bar moves the window — including the title field itself.
     *
     * The field is most of the bar, so refusing to drag from it leaves two
     * thin strips to grab by. It can be both: a press that goes nowhere is a
     * caret, and a press that travels is a drag. Only once the pointer has
     * moved a few pixels does the window start following, and a title already
     * being edited is left alone so text can still be selected with the mouse.
     */
    function wireDrag() {
      const bar = element.querySelector('.cw-bar');
      const SLOP = 4;
      bar.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || element.dataset.max === '1') return;
        const onField = e.target === title;
        if (onField && document.activeElement === title) return;
        if (!onField) e.preventDefault();
        const rect = element.getBoundingClientRect();
        const from = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
        let dragging = !onField;
        if (dragging) { bar.setPointerCapture(e.pointerId); bar.classList.add('is-dragging'); }

        const move = (ev) => {
          if (!dragging) {
            if (Math.abs(ev.clientX - from.x) < SLOP && Math.abs(ev.clientY - from.y) < SLOP) return;
            dragging = true;
            // The press was on its way to the caret; it is a drag instead.
            title.blur();
            window.getSelection()?.removeAllRanges();
            bar.setPointerCapture(ev.pointerId);
            bar.classList.add('is-dragging');
          }
          element.style.left = `${Math.min(Math.max(from.left + ev.clientX - from.x, 0), window.innerWidth - 120)}px`;
          element.style.top = `${Math.min(Math.max(from.top + ev.clientY - from.y, 0), window.innerHeight - 60)}px`;
        };
        const up = () => {
          bar.classList.remove('is-dragging');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          if (dragging) remember({ left: element.offsetLeft, top: element.offsetTop });
        };
        // On the window, because until the drag arms there is no capture, and
        // a fast hand leaves the bar before the fourth pixel.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
    }

    function wireResize() {
      for (const handle of element.querySelectorAll('.cw-resize')) {
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dir = handle.dataset.dir;
          const rect = element.getBoundingClientRect();
          const from = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
          handle.setPointerCapture(e.pointerId);
          const move = (ev) => {
            if (dir.includes('e')) element.style.width = `${Math.max(MIN.width, from.width + ev.clientX - from.x)}px`;
            if (dir.includes('s')) element.style.height = `${Math.max(MIN.height, from.height + ev.clientY - from.y)}px`;
          };
          const up = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            remember({ width: element.offsetWidth, height: element.offsetHeight });
          };
          handle.addEventListener('pointermove', move);
          handle.addEventListener('pointerup', up);
        });
      }
    }

    function wireSplit() {
      splitter.addEventListener('dblclick', () => { text.parentElement.style.flex = '0.5'; preview.style.flex = '0.5'; remember({ split: 0.5 }); });
      splitter.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        splitter.setPointerCapture(e.pointerId);
        splitter.classList.add('dragging');
        const body = element.querySelector('.cw-body').getBoundingClientRect();
        const move = (ev) => {
          const ratio = Math.min(Math.max((ev.clientX - body.left) / body.width, 0.15), 0.85);
          text.parentElement.style.flex = `${ratio}`;
          preview.style.flex = `${1 - ratio}`;
        };
        const up = () => {
          splitter.classList.remove('dragging');
          splitter.removeEventListener('pointermove', move);
          splitter.removeEventListener('pointerup', up);
          remember({ split: Number(text.parentElement.style.flex) || DEFAULT.split });
        };
        splitter.addEventListener('pointermove', move);
        splitter.addEventListener('pointerup', up);
      });
    }

    annotations.on('change', () => { if (!element.hidden) paint(); });
    // The composer follows the reader: a new passage means a new note. Focus
    // stays where it is, or moving between chapters would interrupt typing.
    state.subscribe((value) => {
      if (element.hidden || !target) return;
      if (value.book === target.book && value.chapter === target.chapter) return;
      open(undefined, { focus: false });
    });
  },
};
