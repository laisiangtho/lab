import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  buildTemplateFile, contrastRatio, defaultTemplate, fitText, frameToTemplate, layoutCard,
  parseCardShelf, parseTemplate, readTemplateFile, resizeFrame, snapLines, snapTo, wrapLines, wrapPieces,
} from '../../app/core/card.js';

/** A stand-in for a canvas: every character is one unit wide per point of size. */
const measure = (text, size = 1) => text.length * size;

test('a template keeps what it understands and mends what it does not', () => {
  const t = parseTemplate({
    name: '  Sunday  ', width: 99999, padding: -10, background: 'plaid',
    from: 'red', to: '#112233', align: 'middle', size: 40, watermark: false,
  });
  assert.equal(t.name, 'Sunday');
  assert.equal(t.width, 4096, 'clamped, not refused');
  assert.equal(t.padding, 24);
  assert.equal(t.background, defaultTemplate.background, 'an unknown value falls back');
  assert.equal(t.from, defaultTemplate.from, 'a colour that is not one falls back');
  assert.equal(t.to, '#112233');
  assert.equal(t.align, 'start');
  assert.equal(t.size, 40);
  assert.equal(t.watermark, false);
  assert.equal(t.numbers, true, 'what was not said keeps its default');
});

test('the shelf always has something on it', () => {
  // A new reader starts with finished cards, not one grey default.
  const empty = parseCardShelf(null);
  assert.ok(empty.templates.length >= 3, 'starters');
  assert.ok(empty.templates.every((t) => t.name && t.width > 0));
  assert.equal(empty.open, empty.templates[0].id);

  const shelf = parseCardShelf({ templates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], open: 'b' });
  assert.deepEqual(shelf.templates.map((t) => t.name), ['A', 'B']);
  assert.equal(shelf.open, 'b');
  // An `open` naming a template that is gone falls back to the first.
  assert.equal(parseCardShelf({ templates: [{ id: 'a' }], open: 'z' }).open, 'a');
});

test('wrapping breaks on the pieces it is given, and honours a written line', () => {
  const lines = wrapPieces(['one ', 'two ', 'three ', 'four'], { measure: (t) => measure(t), width: 9 });
  assert.deepEqual(lines, ['one two', 'three', 'four']);
  assert.deepEqual(wrapPieces(['a', '\n', 'b'], { measure, width: 100 }), ['a', 'b']);
});

test('fitting finds the largest size that still fits the room', () => {
  const pieces = 'the lord is my shepherd i shall not want'.split(/(?<= )/);
  const big = fitText({ measure, pieces, width: 400, height: 400, leading: 1.5, min: 10, max: 100 });
  const small = fitText({ measure, pieces, width: 400, height: 90, leading: 1.5, min: 10, max: 100 });
  assert.ok(big.size > small.size, 'less room, smaller text');
  assert.ok(small.lines.length * small.size * 1.5 <= 90, 'and it actually fits');
  // One more point would not have fitted.
  const over = wrapPieces(pieces, { measure: (t) => measure(t, small.size + 1), width: 400 });
  assert.ok(over.length * (small.size + 1) * 1.5 > 90);
});

test('a template travels as a file, and a foreign file is not one', () => {
  const file = buildTemplateFile(parseTemplate({ name: 'Sunday', width: 800 }));
  const back = readTemplateFile(JSON.parse(JSON.stringify(file)));
  assert.equal(back.name, 'Sunday');
  assert.equal(back.width, 800);
  assert.equal(readTemplateFile({ app: 'other', kind: 'card-template' }), null);
  assert.equal(readTemplateFile(null), null);
});

test('a frame is where it was put, in fractions of the card', () => {
  const template = parseTemplate({ width: 1000, height: 1000, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } });
  const out = layoutCard({ template, pieces: 'a b c d e f'.split(/(?<= )/), measure });
  assert.deepEqual(
    { x: out.box.x, y: out.box.y, w: out.box.width, h: out.box.height },
    { x: 100, y: 200, w: 500, h: 400 },
  );
  // The words take what they take, inside the frame they were given.
  assert.equal(out.text.width, 500);
  assert.ok(out.text.height <= out.box.height + 1);
});

test('a template written before frames existed opens where its author left it', () => {
  const old = parseTemplate({ width: 1000, height: 1000, padding: 100, measure: 0.5, align: 'end', anchorY: 0 });
  assert.ok(old.box.w > 0.39 && old.box.w < 0.41, 'half the room inside the margins');
  assert.ok(old.box.x + old.box.w > 0.89, 'still hugging the end');
  assert.ok(old.box.y < 0.15, 'still at the top');
  assert.equal(parseTemplate({ reference: 'none' }).refShow, false);
  assert.equal(parseTemplate({ reference: 'free' }).refFollow, false);
});

test('a frame resizes from the edge that is pulled', () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };
  assert.deepEqual(resizeFrame(start, { handle: 'move', dx: 10, dy: -20 }), { x: 110, y: 80, width: 200, height: 100 });
  assert.deepEqual(resizeFrame(start, { handle: 'e', dx: 50, dy: 0 }), { x: 100, y: 100, width: 250, height: 100 });
  // The opposite edge stays put when the near one is dragged.
  const west = resizeFrame(start, { handle: 'w', dx: 50, dy: 0 });
  assert.equal(west.x, 150);
  assert.equal(west.x + west.width, 300);
  // A frame never turns inside out.
  const crushed = resizeFrame(start, { handle: 'w', dx: 400, dy: 0, min: 40 });
  assert.equal(crushed.width, 40);
  const corner = resizeFrame(start, { handle: 'se', dx: 20, dy: 30 });
  assert.deepEqual(corner, { x: 100, y: 100, width: 220, height: 130 });
});

test('snapping offers the card and the other frame, and says which line it took', () => {
  const lines = snapLines({ width: 1000, height: 1000, padding: 100 }, { x: 300, y: 0, width: 200, height: 50 });
  assert.deepEqual(lines.x, [100, 500, 900, 300, 400, 500]);
  assert.deepEqual(snapTo(497, lines.x, 8), { value: 500, line: 500 });
  assert.deepEqual(snapTo(460, lines.x, 8), { value: 460, line: null }, 'nothing near enough is left alone');
});

test('a frame goes back to fractions, kept inside what a card can hold', () => {
  assert.deepEqual(frameToTemplate({ x: 100, y: 200, width: 500, height: 400 }, { width: 1000, height: 1000 }),
    { x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
  assert.equal(frameToTemplate({ x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 1000 }).w, 0.08,
    'a frame cannot be shrunk to nothing');
  const flat = frameToTemplate({ x: 0, y: 0, width: 500, height: 40 }, { width: 1000, height: 1000 }, true);
  assert.equal(flat.h, undefined, 'the reference has no height of its own');
});

test('the reference follows the text until it is moved', () => {
  const pieces = 'a b c'.split(/(?<= )/);
  const follows = layoutCard({ template: parseTemplate({ refFollow: true }), pieces, measure });
  assert.equal(follows.reference.follows, true);
  assert.ok(follows.reference.y >= follows.text.y + follows.text.height, 'under the words');
  assert.equal(follows.reference.x, follows.box.x, 'and lined up with them');
  assert.equal(layoutCard({ template: parseTemplate({ refShow: false }), pieces, measure }).reference, null);
});

test('a wrapped line remembers which parts are verse numbers', () => {
  const pieces = [
    { text: '1 ', kind: 'number' }, { text: 'aaa ', kind: 'text' },
    { text: '2 ', kind: 'number' }, { text: 'bbb', kind: 'text' },
  ];
  const lines = wrapLines(pieces, { measure, width: 6 });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].parts.map((p) => p.kind), ['number', 'text']);
  assert.equal(lines[0].text, '1 aaa');
  assert.equal(lines[1].parts[0].kind, 'number');
});

test('a reference let go of goes where it was put', () => {
  const t = parseTemplate({ width: 1000, height: 1000, refFollow: false, ref: { x: 0.1, y: 0.8, w: 0.6 } });
  const out = layoutCard({ template: t, pieces: ['a b c'], measure });
  assert.equal(out.reference.follows, false);
  assert.equal(out.reference.x, 100);
  assert.equal(out.reference.y, 800);
  assert.equal(out.reference.width, 600);
});

test('contrast is measured so an unreadable card can be called one', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.ok(contrastRatio('#f2eefb', '#241d33') > 10, 'the Night starter is readable');
  assert.ok(contrastRatio('#cccccc', '#dddddd') < 2, 'and pale on pale is not');
  assert.equal(contrastRatio('nope', '#fff'), null);
});
