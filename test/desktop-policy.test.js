/**
 * The desktop's address and version decisions (targets/desktop/electron/
 * policy.js), which decide what the window may show, who may call the
 * window.lai bridge, and whether a release is offered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAppUrl, isNewer, saveFilters } from '../targets/desktop/electron/policy.js';
import { VERSION } from '../app/version.js';

const APP = 'app://lai/index.html';
const DEV = 'http://localhost:5173/';

test('the app\'s own pages are the app', () => {
  assert.ok(isAppUrl('app://lai/index.html', APP));
  assert.ok(isAppUrl('app://lai/assets/x.js?v=1#top', APP));
  assert.ok(isAppUrl('http://localhost:5173/index.html', DEV));
});

test('nothing else is, though Node gives all of these the origin "null"', () => {
  for (const url of ['file:///etc/passwd', 'data:text/html,<p>x', 'about:blank', 'app://other/index.html',
    'javascript:alert(1)', 'blob:app://lai/123', 'https://example.org/', 'not a url', '']) {
    assert.equal(isAppUrl(url, APP), false, url);
  }
  assert.equal(isAppUrl('http://localhost:5174/', DEV), false, 'another port');
  assert.equal(isAppUrl('https://localhost:5173/', DEV), false, 'another scheme');
});

test('versions compare part by part, as numbers', () => {
  assert.equal(isNewer('26.10.01.4', '26.10.01.3'), true);
  assert.equal(isNewer('26.10.1', '26.9.30'), true, 'not as strings');
  assert.equal(isNewer('26.10.01.3', '26.10.01.3'), false, 'the same build');
  assert.equal(isNewer('26.10.01', '26.10.01.0'), false, 'a missing part is 0');
  assert.equal(isNewer('26.09.30.9', '26.10.01.1'), false, 'older');
});

test('the running build is compared in the form a release tag has', () => {
  assert.match(VERSION, /^\d{2}\.\d{2}\.\d{2}\.\d+$/);
  assert.equal(isNewer(VERSION, VERSION), false, 'the running release is not offered to itself');
});

test('a save dialog offers the type of the file being saved', () => {
  assert.deepEqual(saveFilters('psalm-23.md')[0], { name: 'Markdown', extensions: ['md'] });
  assert.deepEqual(saveFilters('genesis-1.TXT')[0], { name: 'Text', extensions: ['txt'] });
  assert.deepEqual(saveFilters('notes.xyz')[0], { name: 'XYZ', extensions: ['xyz'] });
  assert.deepEqual(saveFilters('no-extension'), [{ name: 'All files', extensions: ['*'] }]);
});
