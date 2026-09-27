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
    from: 'red', to: '#112233', align: 'middle', size: 40, watermark: false, grow: 'sideways',
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
  assert.equal(t.grow, 'scale');
  assert.equal(parseTemplate({ grow: 'keep' }).grow, 'keep');
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

test('a frame is where it was put, in fractions of the card inside its margin', () => {
  const template = parseTemplate({
    width: 1000, height: 1000, padding: 100, space: 'inner',
    box: { x: 0, y: 0.25, w: 1, h: 0.5 },
  });
  const out = layoutCard({ template, pieces: 'a b c d e f'.split(/(?<= )/), measure });
  // 0 and 1 are the margin: the frame fills the width inside it and starts a
  // quarter of the way down the room, not of the card.
  assert.deepEqual(
    { x: out.box.x, y: out.box.y, w: out.box.width, h: out.box.height },
    { x: 100, y: 300, w: 800, h: 400 },
  );
  // The words take what they take, inside the frame they were given.
  assert.equal(out.text.width, 800);
  assert.ok(out.text.height <= out.box.height + 1);
});

test('the margin is a measurement: widen it and the frames come in with it', () => {
  const pieces = 'a b c d e f'.split(/(?<= )/);
  const near = parseTemplate({ width: 1000, height: 1000, padding: 50, space: 'inner', box: { x: 0, y: 0, w: 1, h: 0.5 } });
  const far = parseTemplate({ ...near, padding: 200 });
  const a = layoutCard({ template: near, pieces, measure });
  const b = layoutCard({ template: far, pieces, measure });
  assert.equal(a.box.x, 50);
  assert.equal(b.box.x, 200, 'the frame moved in with the margin');
  assert.ok(b.box.width < a.box.width, 'and lost the room the margin took');
  // A margin too big for the card is clamped rather than turning it inside out.
  const absurd = layoutCard({ template: parseTemplate({ ...near, width: 400, height: 400, padding: 400 }), pieces, measure });
  assert.ok(absurd.box.width > 0);
});

test('a template written before frames existed opens where its author left it', () => {
  const old = parseTemplate({ width: 1000, height: 1000, padding: 100, measure: 0.5, align: 'end', anchorY: 0 });
  assert.ok(old.box.w > 0.49 && old.box.w < 0.51, 'half the room inside the margins');
  assert.ok(old.box.x + old.box.w > 0.99, 'still hugging the end');
  assert.ok(old.box.y < 0.02, 'still at the top');
  assert.equal(parseTemplate({ reference: 'none' }).refShow, false);
  assert.equal(parseTemplate({ reference: 'free' }).refFollow, false);
});

test('a frame written against the whole card is read once into the room inside the margin', () => {
  // Saved before the margin meant anything: fractions of the card itself.
  const moved = parseTemplate({ width: 1000, height: 1000, padding: 100, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } });
  assert.ok(Math.abs(moved.box.x - 0) < 0.02, 'x 0.1 of the card is the margin');
  assert.ok(Math.abs(moved.box.w - 0.625) < 0.01, 'half the card is five eighths of the room');
  // Its pixels are the pixels it always had, which is the point of converting.
  const out = layoutCard({ template: moved, pieces: 'a b'.split(/(?<= )/), measure });
  assert.equal(out.box.x, 100);
  assert.equal(out.box.width, 500);
  // And it only happens once: re-reading a converted template leaves it alone.
  assert.deepEqual(parseTemplate(moved).box, moved.box);
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
  const card = { width: 1000, height: 1000, padding: 100 };
  assert.deepEqual(frameToTemplate({ x: 100, y: 300, width: 800, height: 400 }, card),
    { x: 0, y: 0.25, w: 1, h: 0.5 });
  assert.equal(frameToTemplate({ x: 0, y: 0, width: 10, height: 10 }, card).w, 0.08,
    'a frame cannot be shrunk to nothing');
  // Out past the margin is allowed — text bleeding off the edge is a design.
  assert.ok(frameToTemplate({ x: 0, y: 0, width: 800, height: 400 }, card).x < 0);
  const flat = frameToTemplate({ x: 100, y: 0, width: 400, height: 40 }, card, true);
  assert.equal(flat.h, undefined, 'the reference has no height of its own');
  // A round trip through both, which is what a drag actually does.
  const back = frameToTemplate({ x: 260, y: 420, width: 300, height: 220 }, card);
  const again = layoutCard({ template: parseTemplate({ ...card, space: 'inner', box: back }), pieces: ['a'], measure });
  assert.deepEqual({ x: again.box.x, y: again.box.y, w: again.box.width, h: again.box.height },
    { x: 260, y: 420, w: 300, h: 220 });
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
