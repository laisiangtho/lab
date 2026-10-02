/**
 * The study board: verses and thoughts as cards on a canvas, arranged by hand.
 *
 * Phase 1 edited a card through window.prompt, which not every engine the app
 * runs in implements; here a textarea is laid over the card instead, so editing
 * behaves the same everywhere.
 */

import { h, themeValue as tone } from '../../shell/dom.js';
import { icon } from '../../shell/icons.js';
import { L } from '../../shell/i18n.js';

const KEY = 'board';
const COLOURS = Object.freeze(['#7c3aed', '#e9973f', '#44cf6e', '#53dfdd', '#fa99cd']);
const CARD = Object.freeze({ w: 220, h: 130 });

export default {
  id: 'board',
  setup(ctx) {
    const { records, registry, shell, state, store } = ctx;

    /** @returns {{x,y,w,h,title,text,colour}[]} a copy; every change is saved whole */
    const cards = () => {
      const held = records.get(KEY, null);
      return Array.isArray(held?.cards) ? held.cards.map((c) => ({ ...c })) : [];
    };
    const save = (list) => records.save(KEY, { cards: list });

    registry.command({ id: 'board.open', title: L('doc.board'), icon: 'canvas', opens: 'board', run: () => shell.openDoc('board') });

    registry.doc({
      id: 'board',
      title: L('doc.board'),
      icon: 'canvas',
      mount(el) {
        const canvas = h('canvas', { class: 'board' });
        const count = h('span', { class: 'ov-count' });
        const addButton = h('button', { class: 'ov-act' }, icon('plus'), L('cmd.addCard'));
        const clearButton = h('button', { class: 'ov-act' }, icon('trash'), L('cmd.clear'));
        const editor = h('textarea', { class: 'board-edit', hidden: true, dir: 'auto' });
        const surface = h('div', { class: 'board-surface' }, canvas, editor);

        el.append(h('section', { class: 'doc doc-full' },
          h('div', { class: 'ov-bar' },
            h('span', { class: 'ov-hint' }, L('hint.board')),
            h('span', { class: 'spacer' }),
            count,
            h('span', { class: 'ov-sep' }),
            addButton,
            clearButton),
          surface));

        const context = canvas.getContext('2d');
        if (!context) {
          el.replaceChildren(h('p', { class: 'empty-hint' }, L('err.noCanvas', { what: L('doc.board') })));
          return undefined;
        }

        let list = cards();
        let width = 0;
        let height = 0;
        let drag = null;
        let selected = null;
        let editing = null;

        const at = (x, y) => [...list].reverse().find((c) => x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) ?? null;
        const pointer = (e) => {
          const rect = canvas.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        function resize() {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const rect = canvas.getBoundingClientRect();
          width = rect.width;
          height = rect.height;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          draw();
        }

        function wrap(text, max, size) {
          context.font = `${size}px system-ui, sans-serif`;
          const lines = [];
          let line = '';
          for (const word of String(text).split(/\s+/)) {
            const next = line ? `${line} ${word}` : word;
            if (context.measureText(next).width > max && line) { lines.push(line); line = word; } else line = next;
          }
          if (line) lines.push(line);
          return lines;
        }

        function roundRect(x, y, w, hh, r) {
          context.beginPath();
          context.moveTo(x + r, y);
          context.arcTo(x + w, y, x + w, y + hh, r);
          context.arcTo(x + w, y + hh, x, y + hh, r);
          context.arcTo(x, y + hh, x, y, r);
          context.arcTo(x, y, x + w, y, r);
          context.closePath();
        }

        function draw() {
          context.clearRect(0, 0, width, height);
          context.strokeStyle = tone('--ink-canvas');
          context.lineWidth = 1;
          for (let x = 0; x < width; x += 28) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
          for (let y = 0; y < height; y += 28) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }

          for (const card of list) {
            context.fillStyle = tone('--card-face');
            context.strokeStyle = card === selected ? tone('--accent-1') : tone('--card-edge');
            context.lineWidth = card === selected ? 2 : 1;
            roundRect(card.x, card.y, card.w, card.h, 10);
            context.fill();
            context.stroke();
            context.fillStyle = card.colour || COLOURS[0];
            roundRect(card.x, card.y, 4, card.h, 2);
            context.fill();
            context.fillStyle = tone('--text-faint');
            context.font = '600 11px system-ui, sans-serif';
            context.textAlign = 'left';
            context.fillText(card.title || L('lbl.untitled'), card.x + 14, card.y + 20);
            context.fillStyle = tone('--text-normal');
            context.font = '13px system-ui, sans-serif';
            wrap(card.text, card.w - 28, 13).slice(0, Math.floor((card.h - 34) / 19)).forEach((line, i) => {
              context.fillText(line, card.x + 14, card.y + 40 + i * 19);
            });
          }

          if (!list.length) {
            context.fillStyle = tone('--text-faint');
            context.textAlign = 'center';
            context.font = '14px system-ui, sans-serif';
            context.fillText(L('hint.boardEmpty'), width / 2, height / 2);
          }
          count.textContent = L('lbl.cards', { n: list.length });
        }

        async function commit() {
          selected = null;
          draw();
          await save(list).catch((err) => shell.notify(err.message, 'error'));
        }

        function openEditor(card) {
          editing = card;
          editor.value = card.text;
          Object.assign(editor.style, { left: `${card.x}px`, top: `${card.y}px`, width: `${card.w}px`, height: `${card.h}px` });
          editor.hidden = false;
          editor.focus();
          editor.select();
        }

        function closeEditor() {
          if (!editing) return;
          editing.text = editor.value;
          editing = null;
          editor.hidden = true;
          commit();
        }

        editor.addEventListener('blur', closeEditor);
        editor.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { editing = null; editor.hidden = true; draw(); }
        });

        function addCard(part) {
          list.push({ w: CARD.w, h: CARD.h, colour: COLOURS[list.length % COLOURS.length], title: '', text: '', ...part });
          commit();
        }

        canvas.addEventListener('pointerdown', (e) => {
          if (editing) closeEditor();
          const p = pointer(e);
          const card = at(p.x, p.y);
          selected = card;
          if (card) drag = { card, dx: p.x - card.x, dy: p.y - card.y };
          canvas.setPointerCapture(e.pointerId);
          draw();
        });
        canvas.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const p = pointer(e);
          drag.card.x = Math.round(p.x - drag.dx);
          drag.card.y = Math.round(p.y - drag.dy);
          draw();
        });
        canvas.addEventListener('pointerup', () => {
          if (!drag) return;
          drag = null;
          save(list).catch((err) => shell.notify(err.message, 'error'));
        });
        canvas.addEventListener('dblclick', (e) => {
          const p = pointer(e);
          const card = at(p.x, p.y);
          if (card) { openEditor(card); return; }
          const { book, chapter } = state.get();
          addCard({ title: `${shell.workspace.bookName(book)} ${chapter}`, text: '', x: Math.round(p.x - CARD.w / 2), y: Math.round(p.y - CARD.h / 2) });
        });

        const onKey = (e) => {
          if (editing || !selected) return;
          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
          if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
          list = list.filter((c) => c !== selected);
          commit();
        };
        window.addEventListener('keydown', onKey);

        addButton.addEventListener('click', async () => {
          const { translation, book, chapter } = state.get();
          if (!translation) { shell.notify(L('msg.noTranslations'), 'error'); return; }
          const verses = await store.getChapter(translation, book, chapter);
          if (!verses) { shell.notify(L('ch.noText', { tr: shell.workspace.primaryName() }), 'error'); return; }
          const first = Object.keys(verses).map(Number).sort((a, b) => a - b)[0];
          addCard({
            title: shell.workspace.refLabel(book, chapter, Number(first)),
            text: verses[first].text,
            x: 40 + list.length * 24,
            y: 40 + list.length * 18,
          });
        });

        clearButton.addEventListener('click', () => {
          if (!list.length) return;
          list = [];
          commit();
          shell.notify(L('msg.cleared', { what: L('doc.board') }));
        });

        const onResize = () => resize();
        window.addEventListener('resize', onResize);
        const offRecords = records.on('change', () => {
          if (drag || editing) return; // this pane's own write
          list = cards();
          draw();
        });

        requestAnimationFrame(resize);

        return () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('keydown', onKey);
          offRecords();
        };
      },
    });
  },
};
