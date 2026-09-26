/**
 * The ink layer: freehand marking straight over the reading surface.
 *
 * Strokes belong to the chapter, not the translation, and are kept in the
 * coordinates of the canvas they were drawn on together with its width, so the
 * same marks scale when the window is a different size next time.
 */

import { chapterKey } from '../../core/plans.js';
import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const KEY = 'ink';
const COLOURS = Object.freeze(['#7c3aed', '#e9973f', '#44cf6e', '#53dfdd', '#fa99cd']);
const ERASE_RADIUS = 12;

export default {
  id: 'ink',
  setup(ctx) {
    const { records, registry, shell, state } = ctx;

    const tool = { colour: COLOURS[1], size: 2.5, erase: false };
    let mounted = null; // { canvas, bar, key, strokes }

    const all = () => {
      const held = records.get(KEY, null);
      return held && typeof held === 'object' ? held : {};
    };
    const strokesOf = (key) => {
      const list = all()[key];
      return Array.isArray(list) ? list.map((s) => ({ ...s, points: [...s.points] })) : [];
    };
    const saveStrokes = (key, list) => records.save(KEY, { ...all(), [key]: list });

    registry.command({
      id: 'ink.toggle',
      title: L('cmd.ink'),
      icon: 'pen',
      // The band, not the ribbon: ink is drawn over a chapter, so the button
      // belongs with the other things that act on what is being read, where it
      // greys out on a document tab instead of sitting there dead.
      bar: true,
      needsChapter: true,
      state: () => state.get().ink === true,
      run: () => {
        const on = !state.get().ink;
        state.set({ ink: on });
        if (!on) unmount();
        else sync();
        shell.notify(L('msg.state', { what: L('cmd.ink'), value: L(on ? 'val.on' : 'val.off') }));
      },
    });

    function unmount() {
      mounted?.canvas.remove();
      mounted?.bar.remove();
      mounted = null;
    }

    /** Attach to the primary reading surface, or give up plainly. */
    function sync() {
      if (!state.get().ink) { unmount(); return; }
      const scroll = document.querySelector('.leaf[data-role="primary"] .leaf-scroll');
      const key = chapterKey(state.get().book, state.get().chapter);
      if (!scroll) { unmount(); return; }
      if (mounted && mounted.canvas.isConnected && mounted.scroll === scroll && mounted.key === key) return;
      unmount();

      const width = scroll.clientWidth;
      const height = Math.max(scroll.scrollHeight, scroll.clientHeight);
      if (!width || !height) return;

      const canvas = h('canvas', { class: 'ink-layer' });
      canvas.width = width;
      canvas.height = height;
      Object.assign(canvas.style, { width: `${width}px`, height: `${height}px`, position: 'absolute', left: '0', top: '0' });
      scroll.style.position = 'relative';
      scroll.append(canvas);

      const context = canvas.getContext('2d');
      if (!context) { canvas.remove(); shell.notify(L('err.noCanvas', { what: L('cmd.ink') }), 'error'); return; }

      const strokes = strokesOf(key);
      const bar = buildBar();
      scroll.parentElement.append(bar);
      mounted = { canvas, bar, key, scroll, strokes };

      const redraw = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (const stroke of strokes) {
          const scale = canvas.width / (stroke.width || canvas.width);
          context.strokeStyle = stroke.colour;
          context.lineWidth = stroke.size * scale;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.beginPath();
          stroke.points.forEach(([x, y], i) => (i ? context.lineTo(x * scale, y * scale) : context.moveTo(x * scale, y * scale)));
          context.stroke();
        }
      };
      redraw();

      const commit = () => saveStrokes(key, strokes).catch((err) => shell.notify(err.message, 'error'));
      const point = (e) => {
        const rect = canvas.getBoundingClientRect();
        return [e.clientX - rect.left, e.clientY - rect.top];
      };

      let drawing = null;
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        const p = point(e);
        if (tool.erase) {
          const hit = strokes.findIndex((s) => {
            const scale = canvas.width / (s.width || canvas.width);
            return s.points.some(([x, y]) => Math.hypot(x * scale - p[0], y * scale - p[1]) < ERASE_RADIUS);
          });
          if (hit >= 0) { strokes.splice(hit, 1); redraw(); commit(); }
          return;
        }
        drawing = { colour: tool.colour, size: tool.size, width: canvas.width, points: [p] };
        strokes.push(drawing);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        drawing.points.push(point(e));
        redraw();
      });
      const end = () => { if (drawing) { drawing = null; commit(); } };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);

      function buildBar() {
        const swatches = COLOURS.map((colour) => h('button', {
          title: L('cmd.inkColour'),
          onclick: () => { tool.colour = colour; tool.erase = false; paintBar(); },
          dataset: { colour },
        }, h('span', { class: 'swatch', style: { background: colour } })));
        const erase = h('button', { title: L('cmd.erase'), onclick: () => { tool.erase = !tool.erase; paintBar(); } }, icon('eraser'));
        const undo = h('button', { title: L('cmd.undo'), onclick: () => { strokes.pop(); redraw(); commit(); } }, icon('undo'));
        const clear = h('button', {
          title: L('cmd.clear'),
          onclick: () => { strokes.length = 0; redraw(); commit(); shell.notify(L('msg.cleared', { what: L('cmd.ink') })); },
        }, icon('trash'));
        const done = h('button', { title: L('cmd.done'), onclick: () => { state.set({ ink: false }); unmount(); } }, icon('check'));
        const element = h('div', { class: 'ink-bar' }, ...swatches, erase, undo, clear, done);

        function paintBar() {
          for (const button of swatches) button.classList.toggle('is-on', !tool.erase && button.dataset.colour === tool.colour);
          erase.classList.toggle('is-on', tool.erase);
        }
        paintBar();
        return element;
      }
    }

    // The reading surface is rebuilt on every paint — and asynchronously, since
    // the chapter is read from storage — so the layer follows the surface
    // instead of a single frame: whatever replaces it, the ink comes back.
    const watcher = new MutationObserver(() => { if (state.get().ink) sync(); });
    const watch = () => {
      const host = document.getElementById('panes');
      if (host) watcher.observe(host, { childList: true, subtree: true });
    };
    state.subscribe(() => { watch(); requestAnimationFrame(sync); });
    watch();
  },
};
