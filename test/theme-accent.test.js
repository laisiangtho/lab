/**
 * Accent text must read in both themes whatever colour the picker is given:
 * a single lifted shade used to leave it at 1.6–2.3:1 on the light theme.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accentText, contrast } from '../app/shell/theme.js';

const GROUND = { dark: '#1e1e1e', light: '#f6f6f6' };
// The six swatches the settings offer, and colours a picker can reach that a
// fixed amount of darkening or lightening does not rescue.
const COLOURS = ['#7c3aed', '#2563eb', '#0ea5e9', '#14b8a6', '#e9973f', '#e11d48',
  '#ffff00', '#00ff00', '#000080', '#ffffff', '#000000', '#808080', '#ff00ff'];

test('contrast is the WCAG ratio', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#ffffff', '#ffffff').toFixed(2), '1.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

test('accent text reads at 4.5:1 or better on either theme, for any colour', () => {
  for (const colour of COLOURS) {
    for (const theme of ['dark', 'light']) {
      const shade = accentText(colour, theme);
      const ratio = contrast(shade, GROUND[theme]);
      assert.ok(ratio >= 4.5, `${colour} on ${theme}: ${shade} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('a colour that already reads keeps its usual shade', () => {
  // The default violet: 34% towards white on dark, 35% towards black on light.
  assert.equal(accentText('#7c3aed', 'dark'), '#a97df3');
  assert.equal(accentText('#7c3aed', 'light'), '#51269a');
});

test('the dark shade is lighter than the colour, the light shade darker', () => {
  const lum = (hex) => contrast(hex, '#000000');
  for (const colour of ['#7c3aed', '#e9973f', '#14b8a6']) {
    assert.ok(lum(accentText(colour, 'dark')) > lum(colour), `${colour} lifts on dark`);
    assert.ok(lum(accentText(colour, 'light')) < lum(colour), `${colour} darkens on light`);
  }
});
