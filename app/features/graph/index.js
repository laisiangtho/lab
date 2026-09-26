/**
 * The link graph: chapters as nodes, their connections as edges.
 *
 * Two kinds of connection are drawn. The reader's own — a note's `[[…]]`
 * wikilink from the chapter it was written on — and scripture's own, the cross
 * references printed in the chapters the reader has marked or annotated. Every
 * chapter of the canon would be sixty thousand edges nobody can read, so the
 * graph stays around what the reader has actually touched.
 *
 * A force layout in a canvas, as Phase 1 drew it: the simulation stops the
 * moment its canvas leaves the document, so a background tab costs nothing.
 */

import { extractLinks } from '../../core/markdown.js';
import { chapterKey, parseChapterKey } from '../../core/plans.js';
import { parseReferences } from '../../core/reference.js';
import { h } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

/** How many annotated chapters are read for their cross references. */
const SCAN_LIMIT = 40;

export default {
  id: 'graph',
  setup(ctx) {
    const { annotations, registry, shell, state, store } = ctx;

    registry.command({ id: 'graph.open', title: L('doc.graph'), icon: 'graph', opens: 'graph', run: () => shell.openDoc('graph') });

    registry.doc({
      id: 'graph',
      title: L('doc.graph'),
      icon: 'graph',
      mount(el) {
        const link = h('input', { type: 'range', min: '20', max: '220', value: '110' });
        const repel = h('input', { type: 'range', min: '200', max: '4000', value: '1400' });
        const canvas = h('canvas', { class: 'graph' });
        const count = h('span', { class: 'ov-count' });
        const recentre = h('button', { class: 'ov-act' }, icon('undo'), L('cmd.recentre'));

        el.append(h('section', { class: 'doc doc-full' },
          h('div', { class: 'ov-bar' },
            h('span', { class: 'ov-hint' }, L('hint.graph')),
            h('span', { class: 'spacer' }),
            count,
            h('span', { class: 'ov-sep' }),
            h('label', {}, L('lbl.link'), link),
            h('label', {}, L('lbl.repel'), repel),
            h('span', { class: 'ov-sep' }),
            recentre),
          canvas));

        const context = canvas.getContext('2d');
        if (!context) {
          el.replaceChildren(h('p', { class: 'empty-hint' }, L('err.noCanvas', { what: L('doc.graph') })));
          return undefined;
        }

        let nodes = [];
        let edges = [];
        let frame = null;
        let alpha = 1;
        let drag = null;
        let hover = null;
        let width = 0;
        let height = 0;
        const camera = { x: 0, y: 0 };
        const token = { run: 0 };

        const tone = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const radius = (n) => 6 + Math.min(9, n.degree * 1.6);
        const label = (key) => {
          const p = parseChapterKey(key);
          return p ? `${shell.workspace.bookName(p.book)} ${p.chapter}` : key;
        };

        async function build() {
          const run = ++token.run;
          const index = new Map();
          const list = [];
          const links = [];
          const add = (key, mine) => {
            let node = index.get(key);
            if (!node) {
              node = { key, x: 0, y: 0, vx: 0, vy: 0, degree: 0, mine: false };
              index.set(key, node);
              list.push(node);
            }
            if (mine) node.mine = true;
            return node;
          };
          const join = (a, b, mine) => {
            if (a === b) return;
            if (links.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
            links.push({ a, b, mine });
            a.degree++;
            b.degree++;
          };

          const resolver = shell.workspace.resolver();
          for (const note of annotations.allNotes()) {
            const from = add(chapterKey(note.book, note.chapter), true);
            if (!resolver) continue;
            for (const target of extractLinks(note.text)) {
              const ref = parseReferences(target, resolver)[0];
              if (!ref?.refs) continue;
              join(from, add(chapterKey(ref.refs[0].book, ref.refs[0].chapter), false), true);
            }
          }
          for (const mark of annotations.allMarks()) add(chapterKey(mark.book, mark.chapter), true);

          const { translation, book, chapter } = state.get();
          add(chapterKey(book, chapter), false);

          // Cross references of the chapters the reader has touched.
          if (translation && resolver) {
            const seeds = [...index.keys()].slice(0, SCAN_LIMIT);
            for (const key of seeds) {
              const p = parseChapterKey(key);
              const verses = await store.getChapter(translation, p.book, p.chapter);
              if (run !== token.run) return;
              if (!verses) continue;
              const from = index.get(key);
              for (const verse of Object.values(verses)) {
                if (!verse.ref) continue;
                for (const part of parseReferences(verse.ref, resolver)) {
                  for (const ref of part.refs ?? []) join(from, add(chapterKey(ref.book, ref.chapter), false), false);
                }
              }
            }
          }

          const ring = Math.min(220, 40 + list.length * 9);
          list.forEach((n, i) => {
            const t = (i / Math.max(list.length, 1)) * Math.PI * 2;
            n.x = Math.cos(t) * ring;
            n.y = Math.sin(t) * ring;
          });

          nodes = list;
          edges = links;
          alpha = 1;
          count.textContent = L('lbl.graphSize', { nodes: nodes.length, edges: edges.length });
        }

        function resize() {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const rect = canvas.getBoundingClientRect();
          width = rect.width;
          height = rect.height;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function step() {
          const rest = Number(link.value);
          const push = Number(repel.value);
          for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
              const b = nodes[j];
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const d2 = dx * dx + dy * dy || 0.01;
              const d = Math.sqrt(d2);
              const f = push / d2;
              a.vx -= f * dx / d; a.vy -= f * dy / d;
              b.vx += f * dx / d; b.vy += f * dy / d;
            }
            a.vx -= a.x * 0.004;
            a.vy -= a.y * 0.004;
          }
          for (const e of edges) {
            const dx = e.b.x - e.a.x;
            const dy = e.b.y - e.a.y;
            const d = Math.hypot(dx, dy) || 0.01;
            const f = (d - rest) * 0.02;
            e.a.vx += f * dx / d; e.a.vy += f * dy / d;
            e.b.vx -= f * dx / d; e.b.vy -= f * dy / d;
          }
          for (const n of nodes) {
            if (drag?.node === n) continue;
            n.vx *= 0.82; n.vy *= 0.82;
            n.x += n.vx * alpha; n.y += n.vy * alpha;
          }
          alpha *= 0.994;
        }

        function draw() {
          const { book, chapter } = state.get();
          const open = chapterKey(book, chapter);
          context.clearRect(0, 0, width, height);
          context.save();
          context.translate(width / 2 + camera.x, height / 2 + camera.y);
          context.lineWidth = 1;
          for (const e of edges) {
            const hot = hover && (e.a === hover || e.b === hover);
            context.strokeStyle = hot ? tone('--accent-1') : tone('--graph-edge');
            context.beginPath();
            context.moveTo(e.a.x, e.a.y);
            context.lineTo(e.b.x, e.b.y);
            context.stroke();
          }
          for (const n of nodes) {
            const r = radius(n);
            const isOpen = n.key === open;
            context.beginPath();
            context.arc(n.x, n.y, r, 0, Math.PI * 2);
            context.fillStyle = isOpen ? tone('--accent') : n.mine ? tone('--c-cyan') : hover === n ? tone('--accent-2') : tone('--graph-node');
            context.fill();
            if (isOpen || hover === n) {
              context.lineWidth = 2;
              context.strokeStyle = tone('--accent-2');
              context.stroke();
              context.lineWidth = 1;
            }
            // Busy graphs label only their hubs; a small one can name everything.
            if (n.degree > 1 || nodes.length <= 24 || hover === n || isOpen) {
              context.fillStyle = hover === n || isOpen ? tone('--text-normal') : tone('--graph-label');
              context.font = '11px system-ui, sans-serif';
              context.textAlign = 'center';
              context.fillText(label(n.key), n.x, n.y + r + 13);
            }
          }
          context.restore();
        }

        function loop() {
          if (!canvas.isConnected) { frame = null; return; }
          if (alpha > 0.002 || drag) step();
          draw();
          frame = requestAnimationFrame(loop);
        }

        const at = (clientX, clientY) => {
          const rect = canvas.getBoundingClientRect();
          const x = clientX - rect.left - width / 2 - camera.x;
          const y = clientY - rect.top - height / 2 - camera.y;
          return nodes.find((n) => Math.hypot(n.x - x, n.y - y) < radius(n) + 6);
        };

        canvas.addEventListener('pointerdown', (e) => {
          const node = at(e.clientX, e.clientY);
          drag = node ? { node, moved: false } : { pan: true, x: e.clientX - camera.x, y: e.clientY - camera.y };
          if (node) alpha = Math.max(alpha, 0.35);
          canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
          const rect = canvas.getBoundingClientRect();
          if (drag?.node) {
            drag.node.x = e.clientX - rect.left - width / 2 - camera.x;
            drag.node.y = e.clientY - rect.top - height / 2 - camera.y;
            drag.moved = true;
            alpha = Math.max(alpha, 0.25);
          } else if (drag?.pan) {
            camera.x = e.clientX - drag.x;
            camera.y = e.clientY - drag.y;
          } else {
            const found = at(e.clientX, e.clientY);
            if (found !== hover) { hover = found; canvas.style.cursor = found ? 'pointer' : 'grab'; }
          }
        });
        canvas.addEventListener('pointerup', () => {
          if (drag?.node && !drag.moved) {
            const p = parseChapterKey(drag.node.key);
            if (p) shell.openChapter(p.book, p.chapter);
          }
          drag = null;
        });
        recentre.addEventListener('click', () => { camera.x = 0; camera.y = 0; alpha = 1; });

        const onResize = () => { resize(); };
        window.addEventListener('resize', onResize);

        const rebuild = () => build().then(() => { alpha = 1; }, (err) => shell.notify(err.message, 'error'));
        const offNotes = annotations.on('change', rebuild);

        rebuild().then(() => {
          resize();
          if (!frame) loop();
        });

        return () => {
          offNotes();
          window.removeEventListener('resize', onResize);
          if (frame) cancelAnimationFrame(frame);
          frame = null;
          token.run++;
        };
      },
    });
  },
};
