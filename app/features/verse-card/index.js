/**
 * Verse cards: a passage drawn as an image to keep, send or print — and the
 * templates that decide what one looks like.
 *
 * Two things were wrong with the first version, and both come from the same
 * assumption. It drew one verse, because the verse bar used to be about one
 * verse; and it drew it the app's way, because the app knew best. A passage is
 * usually several verses, and what a card should look like belongs to whoever
 * is sending it — a church has its colours, a phone screen is not a projector.
 *
 * So: the card draws whatever passage it is given, numbering the verses when
 * there is more than one, and everything about its appearance is a template the
 * reader owns, edits beside a live preview, and can export as a file.
 *
 * The card still follows the *text* rather than the interface — the script's
 * own fonts, its direction and its own word breaks — because that is not
 * decoration, it is whether the card is readable at all.
 */

import {
  buildTemplateFile, CARD_ALIGN, CARD_BACKGROUNDS, CARD_FONTS, CARD_LIMITS, CARD_PRESETS,
  contrastRatio, defaultTemplate, frameToTemplate, layoutCard, parseCardShelf, parseTemplate,
  readTemplateFile, resizeFrame, snapLines, snapTo,
} from '../../core/card.js';
import { downloadJson, pickJson } from '../../services/transfer.js';
import { fill, h, keepPlace } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { openMenu } from '../../shell/menu.js';
import { fitStrip, watchStrip } from '../../shell/overflow.js';
import { L } from '../../shell/i18n.js';
import { createRows } from '../../shell/settingrows.js';
import { VERSION } from '../../version.js';

const KEY = 'cards';

/** Faces that carry each script, ahead of the reading face's fallbacks. */
const SCRIPT_FONTS = Object.freeze({
  my: '"Myanmar Text", Georgia, serif',
  ar: '"Noto Naskh Arabic", "Amiri", "Geeza Pro", "Traditional Arabic", serif',
});
const FAMILIES = Object.freeze({
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'Inter, system-ui, sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", Menlo, monospace',
});

export default {
  id: 'verse-card',
  setup(ctx) {
    const { records, registry, shell, state, store } = ctx;

    let shelf = parseCardShelf(records.get(KEY, null));
    const listeners = new Set();
    const repaint = (options = {}) => { for (const fn of listeners) fn(options); };
    const current = () => shelf.templates.find((t) => t.id === shelf.open) ?? shelf.templates[0];

    function keep(next, options = {}) {
      shelf = next;
      records.save(KEY, shelf).catch((err) => shell.notify(err.message, 'error'));
      for (const fn of listeners) fn(options);
    }

    /**
     * Change the open template. `rebuild` is for a change that alters which
     * rows a panel should have — a gradient gaining a second colour — and is
     * off by default, because rebuilding a panel while a control in it is being
     * dragged takes the control away from the pointer.
     */
    const edit = (patch, { rebuild = false } = {}) => keep({
      ...shelf,
      templates: shelf.templates.map((t) => (t.id === shelf.open ? parseTemplate({ ...t, ...patch }, { id: t.id }) : t)),
    }, { rebuild });

    /** The passage the card is being made of, as text and as a label. */
    async function gather({ book, chapter, verse, to }) {
      const { translation } = state.get();
      if (!translation) throw new Error(L('msg.noTranslations'));
      const [meta, verses] = await Promise.all([
        store.getMeta(translation),
        store.getChapter(translation, book, chapter),
      ]);
      const from = verse ?? 1;
      const last = to ?? (verse ?? Number.MAX_SAFE_INTEGER);
      const keys = Object.keys(verses ?? {}).map(Number)
        .filter((n) => n >= from && n <= last)
        .sort((a, b) => a - b);
      if (!keys.length) {
        throw new Error(L('ch.noVerse', { ref: `${shell.workspace.bookName(book)} ${chapter}:${from}` }));
      }
      const span = keys.length > 1 ? `${keys[0]}–${keys.at(-1)}` : String(keys[0]);
      return {
        meta,
        at: { book, chapter, verse: keys[0], to: keys.length > 1 ? keys.at(-1) : null },
        lines: keys.map((n) => ({ verse: n, text: verses[n].text })),
        reference: `${shell.workspace.bookName(book)} ${shell.workspace.number(chapter)}:${span}`,
        slug: `${shell.workspace.bookName(book).replace(/\s+/g, '-')}-${chapter}-${span.replace('–', '-')}-${meta.identify}`,
      };
    }

    const baseLang = (code) => String(code ?? '').toLowerCase().replace('_', '-').split('-')[0];
    const tone = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    function faceFor(template, lang) {
      if (template.font === 'script') return SCRIPT_FONTS[baseLang(lang)] ?? FAMILIES.serif;
      return FAMILIES[template.font] ?? FAMILIES.serif;
    }

    /** Word breaks the language's own way, with a plain split where Intl has none. */
    function segments(text, lang) {
      try {
        return [...new Intl.Segmenter(lang || undefined, { granularity: 'word' }).segment(text)].map((s) => s.segment);
      } catch {
        return text.split(/(\s+)/);
      }
    }

    /**
     * Draw a gathered passage onto a canvas with a template, and report where
     * everything landed so the studio can put handles on it.
     *
     * Everything is in the template's own pixels; the caller decides how big
     * the canvas is shown. The frames come from `layoutCard`, which the studio
     * reads too — what is grabbed is exactly what was drawn.
     */
    function paintCard(canvas, passage, template) {
      const t = template;
      canvas.width = t.width;
      canvas.height = t.height;
      const c = canvas.getContext('2d');
      if (!c) throw new Error(L('err.noCanvas', { what: L('cmd.verseCard') }));

      const lang = passage.meta.info.language.name;
      const rtl = passage.meta.info.language.textdirection === 'rtl';
      const ink = t.text ?? tone('--text-normal');
      const accent = t.accent ?? tone('--accent');
      const face = faceFor(t, lang);

      // --- the ground ---------------------------------------------------
      c.save();
      if (t.radius > 0) {
        c.beginPath();
        c.roundRect(0, 0, t.width, t.height, t.radius);
        c.clip();
      }
      if (t.background === 'solid') {
        c.fillStyle = t.from;
      } else {
        const radians = (t.angle - 90) * Math.PI / 180;
        const reach = Math.max(t.width, t.height);
        const gradient = c.createLinearGradient(
          t.width / 2 - Math.cos(radians) * reach / 2, t.height / 2 - Math.sin(radians) * reach / 2,
          t.width / 2 + Math.cos(radians) * reach / 2, t.height / 2 + Math.sin(radians) * reach / 2,
        );
        gradient.addColorStop(0, t.background === 'theme' ? tone('--export-from') : t.from);
        gradient.addColorStop(1, t.background === 'theme' ? tone('--export-to') : t.to);
        c.fillStyle = gradient;
      }
      c.fillRect(0, 0, t.width, t.height);

      if (t.border > 0) {
        c.strokeStyle = accent;
        c.globalAlpha = 0.45;
        c.lineWidth = t.border;
        c.strokeRect(t.borderInset, t.borderInset, t.width - t.borderInset * 2, t.height - t.borderInset * 2);
        c.globalAlpha = 1;
      }

      // --- the words ------------------------------------------------------
      // The verse numbers travel as their own pieces, so they can be drawn in
      // their own colour: numbers set in the same ink as the verse are read as
      // part of the sentence.
      const numbered = t.numbers && passage.lines.length > 1;
      const pieces = [];
      for (const [i, line] of passage.lines.entries()) {
        if (numbered) pieces.push({ text: `${shell.workspace.number(line.verse)} `, kind: 'number' });
        for (const piece of segments(i && !numbered ? ` ${line.text}` : line.text, lang)) {
          pieces.push({ text: piece, kind: 'text' });
        }
        if (numbered && i < passage.lines.length - 1) pieces.push({ text: ' ', kind: 'text' });
      }

      const chrome = { reference: Math.max(18, Math.round(t.width / 36)), meta: Math.max(14, Math.round(t.width / 45)) };
      const plan = layoutCard({
        template: t,
        pieces,
        measure: (text, size) => { c.font = `${size}px ${face}`; return c.measureText(text).width; },
        leadingScale: baseLang(lang) === 'my' ? 1.24 : 1,
        chrome,
      });

      c.direction = rtl ? 'rtl' : 'ltr';
      c.textBaseline = 'alphabetic';
      /** Where a line starts, inside whichever frame it belongs to. */
      const anchorIn = (frame) => {
        const end = rtl ? t.align === 'start' : t.align === 'end';
        if (t.align === 'center') return frame.x + frame.width / 2;
        return end ? frame.x + frame.width : frame.x;
      };
      const alignFor = () => {
        if (t.align === 'center') return 'center';
        const end = rtl ? t.align === 'start' : t.align === 'end';
        return end ? 'right' : 'left';
      };

      c.textAlign = alignFor();
      c.font = `${plan.size}px ${face}`;
      const numberInk = t.numberColour ?? ink;
      const anchor = anchorIn(plan.text);
      let y = plan.text.y + plan.size;
      for (const line of plan.lines) {
        // One colour is one call. Two means walking the line part by part,
        // which cannot be done right-to-left without reordering the runs — so
        // an RTL card keeps one ink rather than doing it wrongly.
        if (numberInk === ink || rtl || line.parts.length < 2) {
          c.fillStyle = ink;
          c.fillText(line.text, anchor, y);
        } else {
          const widths = line.parts.map((part) => c.measureText(part.text).width);
          const total = widths.reduce((sum, w) => sum + w, 0);
          let x = c.textAlign === 'center' ? anchor - total / 2 : c.textAlign === 'right' ? anchor - total : anchor;
          const align = c.textAlign;
          c.textAlign = 'left';
          for (const [i, part] of line.parts.entries()) {
            c.fillStyle = part.kind === 'number' ? numberInk : ink;
            c.fillText(part.text, x, y);
            x += widths[i];
          }
          c.textAlign = align;
        }
        y += plan.step;
      }

      if (plan.reference) {
        const refAnchor = anchorIn(plan.reference);
        c.fillStyle = accent;
        c.font = `600 ${chrome.reference}px ${FAMILIES.sans}`;
        c.fillText(passage.reference, refAnchor, plan.reference.y + chrome.reference);
        if (t.watermark) {
          c.fillStyle = ink;
          c.globalAlpha = 0.55;
          c.font = `${chrome.meta}px ${FAMILIES.sans}`;
          c.fillText(`${passage.meta.info.shortname} · ${L('app.name')}`, refAnchor, plan.reference.y + chrome.reference + chrome.meta * 1.5);
          c.globalAlpha = 1;
        }
      }
      c.restore();
      return plan;
    }

    async function toBlob(canvas) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(L('err.card'));
      return blob;
    }

    function save(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      shell.notify(L('msg.saved', { name }));
    }

    /** The whole job, for the verse bar and the palette: gather, draw, hand over. */
    async function makeCard(passage, template = current()) {
      const gathered = await gather(passage);
      const canvas = h('canvas');
      paintCard(canvas, gathered, template);
      save(await toBlob(canvas), `${gathered.slug}.png`);
    }

    const guard = (fn) => (...args) => Promise.resolve().then(() => fn(...args))
      .catch((err) => shell.notify(err.message, 'error'));

    registry.verseAction({
      id: 'card.verse',
      title: L('cmd.card'),
      icon: 'card',
      run: guard((p) => makeCard(p)),
    });

    registry.command({
      id: 'card.first',
      title: L('cmd.verseCard'),
      icon: 'card',
      needsChapter: true,
      run: guard(() => {
        const { book, chapter } = state.get();
        return makeCard({ book, chapter, verse: 1, to: null });
      }),
    });

    registry.command({
      id: 'card.studio',
      title: L('doc.cards'),
      icon: 'card',
      opens: 'cards',
      run: () => shell.openDoc('cards'),
    });

    registry.verb({
      id: 'card.verb',
      word: 'card',
      title: L('verb.card'),
      icon: 'card',
      hint: L('verb.cardHint'),
      run: guard((p) => makeCard(p)),
    });

    registry.setting({
      id: 'cards.templates',
      section: 'study',
      order: 40,
      build: (ui) => ui.action({
        name: L('doc.cards'),
        hint: L('set.cardsHint'),
        value: String(shelf.templates.length),
        label: L('cmd.open'),
        glyph: 'card',
        onClick: () => shell.openDoc('cards'),
      }),
    });


    // --- the studio ----------------------------------------------------------

    /**
     * The card editor.
     *
     * What a hand expects of a thing on a canvas: press it to pick it up, drag
     * it and it follows exactly, take a corner and the opposite one stays put,
     * lines appear when it lines up with something, the arrow keys nudge it, and
     * a mistake can be undone. None of that is special to cards — it is simply
     * what an editor is — and until it was all here the studio was a settings
     * page with a picture next to it.
     *
     * The frames come from `layoutCard` and the arithmetic of moving them from
     * `core/card.js`, so the handles sit exactly where the paint did and the
     * rules can be tested without a browser.
     */
    registry.doc({
      id: 'cards',
      title: L('doc.cards'),
      icon: 'card',
      mount(el) {
        const canvas = h('canvas', { class: 'cd-canvas' });
        const frame = h('div', { class: 'cd-frame' }, canvas);
        const stage = h('div', { class: 'cd-stage' }, frame);
        const readout = h('span', { class: 'cd-readout' });
        const panel = h('div', { class: 'cd-panel popover', hidden: true });
        const hint = h('p', { class: 'cd-hint' });

        let passage = null;
        let plan = null;
        /** The passage the reader chose, or null to follow what they are reading. */
        let chosen = null;
        let openPanel = null;
        /** A template held aside while something is being dragged. */
        let live = null;
        /** What is picked up: 'text', 'reference', or nothing. */
        let picked = null;
        /** Templates as they were, for undo. */
        const past = [];
        const future = [];

        const guardHere = (fn) => (...args) => Promise.resolve().then(() => fn(...args))
          .catch((err) => shell.notify(err.message, 'error'));
        const shown = () => live ?? current();

        // --- history --------------------------------------------------------

        /**
         * Every change to the open template goes through here, so undo is a
         * fact of the editor rather than something bolted on: nothing is
         * written down that cannot be taken back.
         */
        function change(patch, { rebuild = false } = {}) {
          past.push(current());
          if (past.length > 60) past.shift();
          future.length = 0;
          edit(patch, { rebuild });
        }

        function undo() {
          const previous = past.pop();
          if (!previous) return;
          future.push(current());
          edit(previous, { rebuild: true });
        }

        function redo() {
          const next = future.pop();
          if (!next) return;
          past.push(current());
          edit(next, { rebuild: true });
        }

        // --- drawing ---------------------------------------------------------

        async function load() {
          const { book, chapter } = state.get();
          passage = await gather(chosen ?? { book, chapter, verse: 1, to: 4 });
        }

        function draw() {
          frame.hidden = !passage;
          if (!passage) { for (const box of Object.values(boxes)) box.hidden = true; return; }
          const t = shown();
          fitStage(t);
          plan = paintCard(canvas, passage, t);
          frame.style.borderRadius = `${Math.round(t.radius * scale())}px`;
          readout.textContent = L('cd.note', { w: t.width, h: t.height, size: plan.size, lines: plan.lines.length });
          placeHandles();
          sayHint();
        }

        /**
         * How big the card is shown. Worked out rather than left to
         * `max-height: 100%`, which resolves against a parent whose own height
         * is automatic and is therefore ignored. The number is also what maps a
         * pointer back onto the card.
         */
        function fitStage(t) {
          const rect = stage.getBoundingClientRect();
          const room = { w: Math.max(80, rect.width - 40), h: Math.max(80, rect.height - 40) };
          const k = Math.min(room.w / t.width, room.h / t.height, 1);
          canvas.style.width = `${Math.round(t.width * k)}px`;
          canvas.style.height = `${Math.round(t.height * k)}px`;
          return k;
        }

        const scale = () => (canvas.clientWidth || 1) / (shown().width || 1);

        function sayHint(message = null) {
          if (message) { hint.dataset.warn = 'false'; hint.textContent = message; return; }
          const t = shown();
          const ink = t.text ?? tone('--text-normal');
          // A gradient is two grounds, and the text has to survive both.
          const grounds = t.background === 'theme'
            ? [tone('--export-from'), tone('--export-to')]
            : t.background === 'gradient' ? [t.from, t.to] : [t.from];
          const ratio = grounds
            .map((ground) => contrastRatio(ink, ground))
            .filter((n) => n !== null)
            .reduce((worst, n) => (worst === null ? n : Math.min(worst, n)), null);
          hint.dataset.warn = String(ratio !== null && ratio < 3);
          hint.textContent = ratio !== null && ratio < 3
            ? L('cd.contrast', { ratio: ratio.toFixed(1) })
            : L('cd.hint');
        }

        // --- the frames on screen --------------------------------------------

        const HANDLES = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
        const FLAT_HANDLES = Object.freeze(['e', 'w']);

        const makeBox = (part, handles) => h('div', {
          class: `cd-box cd-box-${part}`, dataset: { part }, hidden: true,
          tabindex: '0', 'aria-label': L(part === 'text' ? 'cd.textBlock' : 'cd.refBlock'),
        }, handles.map((handle) => h('span', {
          class: `cd-grip cd-grip-${handle}`, dataset: { handle, part },
        })));

        const boxes = {
          text: makeBox('text', HANDLES),
          reference: makeBox('reference', FLAT_HANDLES),
        };
        const guides = { x: h('div', { class: 'cd-guide cd-guide-x', hidden: true }), y: h('div', { class: 'cd-guide cd-guide-y', hidden: true }) };
        const safe = h('div', { class: 'cd-safe', hidden: true, title: L('cd.safeArea') });
        frame.append(safe, boxes.text, boxes.reference, guides.x, guides.y);

        /** The frame of a part, in card pixels, as the last paint left it. */
        const frameOf = (part) => (part === 'text' ? plan?.box : plan?.reference);

        function placeHandles() {
          if (!plan) return;
          const k = scale();
          for (const [part, node] of Object.entries(boxes)) {
            const box = frameOf(part);
            if (!box) { node.hidden = true; continue; }
            Object.assign(node.style, {
              left: `${box.x * k}px`, top: `${box.y * k}px`,
              width: `${box.width * k}px`, height: `${box.height * k}px`,
            });
            node.hidden = false;
            node.classList.toggle('is-picked', picked === part);
          }
          const t = shown();
          const tall = t.height / t.width >= 1.7;
          safe.hidden = !tall;
          if (tall) safe.style.setProperty('--safe', `${Math.round(t.height * 0.14 * k)}px`);
        }

        function pick(part) {
          picked = part;
          placeHandles();
          if (part) boxes[part].focus({ preventScroll: true });
        }

        /** Card pixels from a pointer event. */
        function cardPoint(event) {
          const rect = canvas.getBoundingClientRect();
          const k = scale();
          return { x: (event.clientX - rect.left) / k, y: (event.clientY - rect.top) / k };
        }

        // --- moving and sizing ------------------------------------------------

        frame.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || !plan) return;
          const gripEl = event.target.closest('.cd-grip');
          const boxEl = event.target.closest('.cd-box');
          const part = gripEl?.dataset.part ?? boxEl?.dataset.part ?? null;
          if (!part) { pick(null); return; }

          event.preventDefault();
          pick(part);
          const handle = gripEl?.dataset.handle ?? 'move';
          const from = current();
          const start = cardPoint(event);
          const startBox = { ...frameOf(part) };
          const flat = part === 'reference';
          const other = frameOf(part === 'text' ? 'reference' : 'text');
          const lines = snapLines(from, other);
          const tolerance = 8 / Math.max(scale(), 0.05);
          let moved = false;

          const move = (e) => {
            const at = cardPoint(e);
            const dx = at.x - start.x;
            const dy = at.y - start.y;
            if (!moved && Math.abs(dx) * scale() < 3 && Math.abs(dy) * scale() < 3) return;
            moved = true;

            let box = resizeFrame(startBox, { handle, dx, dy, min: 40 });
            // Snapping, and the guide that says it happened. Held down, the
            // Alt key turns it off, which is the way out every editor offers.
            let guideX = null;
            let guideY = null;
            if (!e.altKey) {
              const edgesX = handle === 'move'
                ? [box.x, box.x + box.width / 2, box.x + box.width]
                : handle.includes('w') ? [box.x] : handle.includes('e') ? [box.x + box.width] : [];
              for (const edge of edgesX) {
                const { value, line } = snapTo(edge, lines.x, tolerance);
                if (line === null) continue;
                const shift = value - edge;
                if (handle === 'move') box.x += shift;
                else if (handle.includes('w')) { box.x += shift; box.width -= shift; }
                else box.width += shift;
                guideX = line;
                break;
              }
              const edgesY = handle === 'move'
                ? [box.y, box.y + box.height / 2, box.y + box.height]
                : handle.includes('n') ? [box.y] : handle.includes('s') ? [box.y + box.height] : [];
              for (const edge of edgesY) {
                const { value, line } = snapTo(edge, lines.y, tolerance);
                if (line === null) continue;
                const shift = value - edge;
                if (handle === 'move') box.y += shift;
                else if (handle.includes('n')) { box.y += shift; box.height -= shift; }
                else box.height += shift;
                guideY = line;
                break;
              }
            }
            showGuide('x', guideX);
            showGuide('y', guideY);

            live = parseTemplate({
              ...from,
              [flat ? 'ref' : 'box']: frameToTemplate(box, from, flat),
              ...(flat ? { refFollow: false } : {}),
            }, { id: from.id });
            draw();
            sayHint(L('cd.at', {
              x: Math.round(box.x), y: Math.round(box.y),
              w: Math.round(box.width), h: Math.round(box.height),
            }));
          };

          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            showGuide('x', null);
            showGuide('y', null);
            const settled = live;
            live = null;
            if (!moved || !settled) { draw(); return; }
            change(settled);
          };

          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });

        function showGuide(axis, at) {
          const node = guides[axis];
          if (at === null) { node.hidden = true; return; }
          const k = scale();
          if (axis === 'x') node.style.left = `${at * k}px`;
          else node.style.top = `${at * k}px`;
          node.hidden = false;
        }

        /**
         * The keyboard does what the pointer does. Arrows nudge by a pixel of
         * the card, ten with shift; Escape puts the frame down; Mod+Z takes back
         * whatever the last thing was.
         */
        el.addEventListener('keydown', (event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) redo(); else undo();
            return;
          }
          if (event.key === 'Escape') { if (picked) { pick(null); event.preventDefault(); } return; }
          if (!picked || !plan || !event.key.startsWith('Arrow')) return;
          const step = event.shiftKey ? 10 : 1;
          const box = { ...frameOf(picked) };
          if (event.key === 'ArrowLeft') box.x -= step;
          else if (event.key === 'ArrowRight') box.x += step;
          else if (event.key === 'ArrowUp') box.y -= step;
          else box.y += step;
          event.preventDefault();
          const flat = picked === 'reference';
          const t = current();
          change({
            [flat ? 'ref' : 'box']: frameToTemplate(box, t, flat),
            ...(flat ? { refFollow: false } : {}),
          });
          boxes[picked].focus({ preventScroll: true });
        });

        // --- the panels --------------------------------------------------------

        const ui = createRows({ refresh: () => {} });

        /** A number that is dragged: the card follows, the template is written once. */
        const number = (label, key, spec, unit, hintText = '') => ui.number({
          name: label, hint: hintText, spec, unit, value: current()[key],
          decimals: spec.step < 1 ? 2 : 0,
          onChange: (value) => { live = parseTemplate({ ...current(), [key]: value }, { id: current().id }); draw(); },
          onCommit: (value) => { live = null; change({ [key]: value }); },
        });

        const PANELS = {
          templates: {
            icon: 'files',
            title: () => L('cd.templates'),
            build: () => [
              h('div', { class: 'cd-list' }, shelf.templates.map((t) => h('button', {
                class: `cd-item${t.id === shelf.open ? ' is-on' : ''}`,
                onclick: () => keep({ ...shelf, open: t.id }, { rebuild: true }),
              },
                h('span', { class: 'cd-item-n' }, t.name),
                h('span', { class: 'cd-item-s' }, `${t.width}×${t.height}`)))),
              h('div', { class: 'cd-panel-foot' },
                iconButton('plus', L('cd.new'), duplicate),
                iconButton('enter', L('cd.import'), guardHere(importTemplate)),
                iconButton('download', L('cd.export'), exportTemplate),
                iconButton('undo', L('cd.resetTemplate'), () => change({ ...defaultTemplate, id: current().id, name: current().name }, { rebuild: true })),
                iconButton('trash', L('cd.deleteOne'), guardHere(remove), 'danger')),
            ],
          },
          passage: {
            icon: 'verses',
            title: () => L('cd.passage'),
            build: () => {
              const field = h('input', {
                class: 'cd-ref-input', spellcheck: 'false',
                value: passage?.reference ?? '', placeholder: L('cd.passagePh'), 'aria-label': L('cd.passage'),
                onkeydown: (e) => { if (e.key === 'Enter') useTyped(e.currentTarget.value); },
              });
              return [
                h('p', { class: 'cd-note' }, L('cd.passageHint')),
                h('div', { class: 'cd-ref-row' },
                  field,
                  iconButton('check', L('cd.passageUse'), () => useTyped(field.value), 'primary')),
                ui.action({
                  name: L('cd.following'),
                  hint: chosen ? L('cd.fixed') : L('cd.follows'),
                  label: L('cd.follow'), glyph: 'book-open',
                  disabled: !chosen,
                  onClick: () => { chosen = null; run(); },
                }),
              ];
            },
          },
          shape: {
            icon: 'frame',
            title: () => L('cd.shape'),
            build: () => [
              ui.row({ name: L('cd.preset') },
                h('div', { class: 'rp-seg cd-presets' }, CARD_PRESETS.map((p) => h('button', {
                  'aria-pressed': String(p.width === current().width && p.height === current().height),
                  onclick: () => change({ width: p.width, height: p.height }, { rebuild: true }),
                }, L(`cd.size.${p.id}`))))),
              number(L('cd.width'), 'width', CARD_LIMITS.width, 'px'),
              number(L('cd.height'), 'height', CARD_LIMITS.height, 'px'),
              number(L('cd.padding'), 'padding', CARD_LIMITS.padding, 'px', L('cd.paddingHint')),
              number(L('cd.radius'), 'radius', CARD_LIMITS.radius, 'px'),
              ui.action({
                name: L('cd.fitFrames'), hint: L('cd.fitFramesHint'),
                label: L('cd.fitFramesDo'), glyph: 'move', onClick: () => fitFrames(),
              }),
            ],
          },
          colour: {
            icon: 'droplet',
            title: () => L('cd.colour'),
            build: () => [
              ui.choice({
                name: L('cd.background'),
                options: CARD_BACKGROUNDS.map((id) => [id, L(`cd.bg.${id}`)]),
                value: current().background,
                onChange: (value) => change({ background: value }, { rebuild: true }),
              }),
              current().background === 'theme' ? null : colourRow(L('cd.from'), 'from'),
              current().background === 'gradient' ? colourRow(L('cd.to'), 'to') : null,
              current().background === 'gradient' ? number(L('cd.angle'), 'angle', CARD_LIMITS.angle, '°') : null,
              colourRow(L('cd.ink'), 'text', true),
              colourRow(L('cd.numberColour'), 'numberColour', true),
              colourRow(L('cd.accentColour'), 'accent', true),
              number(L('cd.border'), 'border', CARD_LIMITS.border, 'px'),
            ],
          },
          type: {
            icon: 'type',
            title: () => L('cd.type'),
            build: () => [
              ui.choice({
                name: L('set.font'),
                options: CARD_FONTS.map((id) => [id, L(`cd.font.${id}`)]),
                value: current().font, onChange: (value) => change({ font: value }),
              }),
              ui.choice({
                name: L('cd.align'),
                options: CARD_ALIGN.map((id) => [id, L(`cd.align.${id}`), `align-${id === 'center' ? 'center' : id}`]),
                value: current().align, onChange: (value) => change({ align: value }),
              }),
              ui.toggle({
                name: L('cd.autoSize'), hint: L('cd.autoSizeHint'),
                value: current().size === 0,
                onChange: (on) => change({ size: on ? 0 : (plan?.size ?? 54) }, { rebuild: true }),
              }),
              current().size === 0 ? null : number(L('lbl.textSize'), 'size', CARD_LIMITS.size, 'px'),
              number(L('lbl.lineHeight'), 'leading', CARD_LIMITS.leading, ''),
            ],
          },
          reference: {
            icon: 'quote',
            title: () => L('cd.reference'),
            build: () => [
              ui.toggle({
                name: L('cd.refShow'), hint: L('cd.refShowHint'),
                value: current().refShow, onChange: (on) => change({ refShow: on }, { rebuild: true }),
              }),
              ui.toggle({
                name: L('cd.refFollow'), hint: L('cd.refFollowHint'),
                value: current().refFollow, onChange: (on) => change({ refFollow: on }),
              }),
              ui.toggle({ name: L('cd.numbers'), hint: L('cd.numbersHint'), value: current().numbers, onChange: (on) => change({ numbers: on }) }),
              ui.toggle({ name: L('cd.watermark'), hint: L('cd.watermarkHint'), value: current().watermark, onChange: (on) => change({ watermark: on }) }),
            ],
          },
        };

        /** Both frames back inside the margins — the way out of any arrangement. */
        function fitFrames() {
          const t = current();
          const margin = t.padding / t.width;
          const marginY = t.padding / t.height;
          change({
            box: { x: margin, y: marginY, w: 1 - margin * 2, h: (1 - marginY * 2) * 0.72 },
            ref: { x: margin, y: 1 - marginY - 0.08, w: 1 - margin * 2 },
          }, { rebuild: true });
        }

        /**
         * Open a panel under the button that asked for it, or close it again.
         * It has no heading and no close button of its own: the tool that opened
         * it closes it, so does Escape, so does a press anywhere else — a title
         * bar on a panel this small is a row of chrome saying what the pressed
         * button already says.
         */
        function show(which, anchor = null) {
          if (openPanel === which && !panel.hidden) { closePanel(); return; }
          openPanel = which;
          fill(panel, h('div', { class: 'cd-panel-body' }, ...PANELS[which].build().filter(Boolean)));
          panel.hidden = false;
          const button = anchor ?? el.querySelector(`.cd-tool[data-panel="${which}"]`) ?? more;
          const rect = button.getBoundingClientRect();
          const host = el.getBoundingClientRect();
          const width = panel.offsetWidth;
          panel.style.left = `${Math.min(Math.max(rect.left - host.left, 8), Math.max(8, host.width - width - 8))}px`;
          panel.style.top = `${rect.bottom - host.top + 6}px`;
          for (const tool of el.querySelectorAll('.cd-tool[data-panel]')) {
            tool.setAttribute('aria-expanded', String(tool.dataset.panel === which));
          }
        }

        function closePanel() {
          panel.hidden = true;
          openPanel = null;
          for (const tool of el.querySelectorAll('.cd-tool[data-panel]')) tool.setAttribute('aria-expanded', 'false');
        }

        el.addEventListener('pointerdown', (e) => {
          if (panel.hidden || panel.contains(e.target) || e.target.closest('.cd-tool')) return;
          closePanel();
        });
        el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

        /** A colour, picked with the app's own picker: live while dragging, kept on release. */
        function colourRow(name, key, resettable = false) {
          const fallback = key === 'text' ? tone('--text-normal')
            : key === 'accent' ? tone('--accent')
              : key === 'numberColour' ? (current().text ?? tone('--text-normal')) : current().from;
          const value = current()[key] ?? fallback;
          const swatch = h('button', {
            class: 'accent-swatch', style: { background: value },
            title: name, 'aria-label': name, 'aria-expanded': 'false',
          });
          swatch.onclick = () => shell.pickColour(swatch, {
            value,
            onChange: (colour) => {
              swatch.style.background = colour;
              live = parseTemplate({ ...current(), [key]: colour }, { id: current().id });
              draw();
            },
            onCommit: (colour) => { live = null; change({ [key]: colour }); },
          });
          return ui.row({ name },
            h('div', { class: 'accent-row' },
              swatch,
              resettable
                ? h('button', {
                  class: 'set-reset', title: L('set.accentDefault'), 'aria-label': L('set.accentDefault'),
                  disabled: current()[key] === null,
                  onclick: () => change({ [key]: null }, { rebuild: true }),
                }, icon('undo'))
                : null));
        }

        // --- the toolbar --------------------------------------------------------

        function useTyped(text) {
          const found = shell.readPassage(text);
          if (!found) { shell.notify(L('cd.noPassage', { text })); return; }
          chosen = { book: found.book, chapter: found.chapter, verse: found.verse ?? 1, to: found.to ?? null };
          run();
        }

        function duplicate() {
          const t = current();
          const copy = parseTemplate({ ...t, name: L('cd.copyOf', { name: t.name }) }, { id: `t${Date.now().toString(36)}` });
          keep({ templates: [...shelf.templates, copy], open: copy.id }, { rebuild: true });
        }

        function exportTemplate() {
          const t = current();
          downloadJson(`${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'card'}.laicard.json`,
            buildTemplateFile(t, { appVersion: VERSION }));
          shell.notify(L('cd.exported', { name: t.name }));
        }

        async function remove() {
          if (shelf.templates.length < 2) { shell.notify(L('cd.lastOne')); return; }
          const sure = await shell.confirm({
            title: L('cd.askDelete'), body: current().name, confirm: L('cmd.delete'), danger: true,
          });
          if (!sure) return;
          const left = shelf.templates.filter((t) => t.id !== shelf.open);
          keep({ templates: left, open: left[0].id }, { rebuild: true });
        }

        async function importTemplate() {
          const file = await pickJson();
          if (!file) return;
          const template = readTemplateFile(file.data);
          if (!template) throw new Error(L('cd.notATemplate', { file: file.name }));
          const landed = parseTemplate(template, { id: `t${Date.now().toString(36)}` });
          keep({ templates: [...shelf.templates, landed], open: landed.id }, { rebuild: true });
          shell.notify(L('cd.imported', { name: landed.name }));
        }

        function iconButton(glyph, label, onclick, extra = '') {
          return h('button', {
            class: `cd-tool${extra ? ` ${extra}` : ''}`, title: label, 'aria-label': label, onclick,
          }, icon(glyph));
        }

        function panelButton(which) {
          const entry = PANELS[which];
          const button = iconButton(entry.icon, entry.title(), () => show(which, button));
          button.dataset.panel = which;
          button.setAttribute('aria-haspopup', 'dialog');
          button.setAttribute('aria-expanded', 'false');
          return button;
        }

        const name = h('input', { class: 'cd-name', 'aria-label': L('cd.name'),
          onchange: (e) => change({ name: e.currentTarget.value }) });

        const tools = Object.keys(PANELS).map(panelButton);
        const more = h('button', {
          class: 'cd-tool cd-more', hidden: true, 'aria-haspopup': 'menu',
          title: L('cd.moreTools'), 'aria-label': L('cd.moreTools'),
          onclick: () => openMenu(more, Object.keys(PANELS).map((which) => ({
            id: which,
            title: PANELS[which].title(),
            icon: PANELS[which].icon,
            active: which === openPanel,
            quiet: !tools.find((b) => b.dataset.panel === which)?.hidden,
            run: () => show(which, more),
          }))),
        }, icon('more'));

        const actions = h('div', { class: 'cd-bar-acts' },
          readout,
          iconButton('undo', L('cd.undo'), () => undo()),
          iconButton('copy', L('cd.copyImage'), guardHere(async () => {
            const blob = await toBlob(canvas);
            if (!navigator.clipboard?.write) throw new Error(L('cd.noClipboard'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            shell.notify(L('msg.copied', { what: passage?.reference ?? L('doc.cards') }));
          })),
          iconButton('download', L('cd.savePng'), guardHere(async () => {
            if (!passage) return;
            save(await toBlob(canvas), `${passage.slug}.png`);
          })));

        const toolbar = h('div', { class: 'cd-bar' },
          name,
          h('span', { class: 'cd-bar-sep' }),
          ...tools,
          more,
          h('span', { class: 'spacer' }),
          actions);

        el.classList.add('cd-wrap');
        el.append(h('section', { class: 'doc doc-full cards' }, toolbar, stage, hint, panel));

        const fitTools = () => fitStrip(toolbar, {
          items: tools, more, fixed: [name, actions, ...toolbar.querySelectorAll('.cd-bar-sep')],
        });
        const watched = new WeakSet();

        /**
         * Only what changed. The canvas is never rebuilt, and a panel is rebuilt
         * only when a change alters which rows belong in it — never while a
         * control in it is being dragged.
         */
        function repaint({ rebuild = false } = {}) {
          name.value = current().name;
          if (rebuild && openPanel) show(openPanel);
          draw();
          watchStrip(toolbar, fitTools, watched);
        }

        const run = () => load().then(() => repaint({ rebuild: true })).catch((err) => {
          passage = null;
          hint.dataset.warn = 'true';
          hint.textContent = err.message;
          draw();
        });

        const onShelfChange = (options = {}) => repaint(options);
        listeners.add(onShelfChange);
        const offState = state.subscribe(() => { if (!chosen) run(); });
        const refit = () => { if (passage) { fitStage(shown()); placeHandles(); } };
        window.addEventListener('resize', refit);
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(refit).observe(stage);
        run();
        return () => { listeners.delete(onShelfChange); offState(); window.removeEventListener('resize', refit); };
      },
    });
  },
};
