/**
 * The window-button overlay takes "#rrggbb"; the browser reports computed
 * colours as rgb(). The conversion between them, and what it refuses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cssColorToHex } from '../app/shell/theme.js';

test('a computed colour becomes #rrggbb, in every way the browser writes it', () => {
  assert.equal(cssColorToHex('rgb(231, 231, 234)'), '#e7e7ea');
  assert.equal(cssColorToHex('rgb(12,12,14)'), '#0c0c0e');
  assert.equal(cssColorToHex('rgba(0, 0, 0, 1)'), '#000000');
  assert.equal(cssColorToHex('rgb(255 255 255 / 100%)'), '#ffffff');
  assert.equal(cssColorToHex('  rgb(1, 2, 3)  '), '#010203');
});

test('a colour with no single opaque value is refused by name', () => {
  assert.throws(() => cssColorToHex('rgba(0, 0, 0, 0)'), /not opaque/);
  assert.throws(() => cssColorToHex('rgba(10, 10, 10, 0.5)'), /not opaque/);
  assert.throws(() => cssColorToHex('transparent'), /not an rgb\(\) colour/);
  assert.throws(() => cssColorToHex('color(srgb 1 1 1)'), /not an rgb\(\) colour/);
});
