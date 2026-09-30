/**
 * The palette's ranking: an exact title wins, and between equally tight
 * matches the shorter title does — not whichever was registered first.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filter } from '../app/shell/modal.js';

const titles = (items) => items.map((i) => i.title);

test('the title that is exactly what was typed comes first', () => {
  // Burmese starts both with the same word: Export settings, then Settings.
  const items = [{ title: 'ဆက်တင်များ ထုတ်ယူ' }, { title: 'ဆက်တင်များ တင်သွင်း' }, { title: 'ဆက်တင်များ' }];
  assert.equal(titles(filter(items, 'ဆက်တင်များ'))[0], 'ဆက်တင်များ');
  assert.equal(titles(filter([{ title: 'Export settings' }, { title: 'Settings' }], 'settings'))[0], 'Settings');
});

test('an equally tight match goes to the shorter title', () => {
  const items = [{ title: 'Notes manager' }, { title: 'Notes' }];
  assert.deepEqual(titles(filter(items, 'not')), ['Notes', 'Notes manager']);
});

test('a looser match still ranks below a tighter one', () => {
  // "nt": Notes skips one letter, Next tab two — the tighter one wins even
  // though it was listed second.
  const items = [{ title: 'Next tab' }, { title: 'Notes' }];
  assert.equal(titles(filter(items, 'nt'))[0], 'Notes');
  assert.deepEqual(filter(items, 'zzz'), []);
  assert.equal(filter(items, '  ').length, 2, 'an empty query lists everything');
});
