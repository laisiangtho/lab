import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hsvToHex, parseHex, rgbToHsv } from '../../app/shell/colorpicker.js';

test('hex parsing takes both lengths, and refuses anything else', () => {
  assert.deepEqual(parseHex('#7c3aed'), { r: 124, g: 58, b: 237 });
  assert.deepEqual(parseHex('abc'), { r: 170, g: 187, b: 204 });
  assert.equal(parseHex('#12345'), null);
  assert.equal(parseHex('rebeccapurple'), null);
  assert.equal(parseHex(null), null);
});

test('a colour survives the trip through HSV', () => {
  for (const hex of ['#7c3aed', '#000000', '#ffffff', '#e11d48', '#14b8a6', '#0ea5e9']) {
    assert.equal(hsvToHex(rgbToHsv(parseHex(hex))), hex, hex);
  }
});

test('grey has no hue and no saturation', () => {
  const grey = rgbToHsv({ r: 128, g: 128, b: 128 });
  assert.equal(grey.h, 0);
  assert.equal(grey.s, 0);
});
