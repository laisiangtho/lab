/**
 * Every shipped PNG was drawn from the SVG as it is now, and is the size the
 * build that uses it expects. A changed SVG with stale PNGs fails here, with
 * the command that fixes it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ICONS, sourceHash } from '../scripts/icons.mjs';
import { root } from './helpers.js';

/** Width and height from a PNG's IHDR, which is always the first chunk. */
function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${path} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('the PNGs were drawn from the SVG as it is now', () => {
  const stamp = root('assets/icons/source.sha256');
  assert.ok(existsSync(stamp), 'assets/icons/source.sha256 is missing: run npm run icons -- --apply');
  assert.equal(readFileSync(stamp, 'utf8').trim(), sourceHash(),
    'public/icons/icon.svg changed since the PNGs were drawn: run npm run icons -- --apply');
});

test('every icon is there, at its size', () => {
  for (const icon of ICONS) {
    const path = root(icon.path);
    assert.ok(existsSync(path), `${icon.path} is missing`);
    assert.deepEqual(pngSize(path), { width: icon.size, height: icon.size }, icon.path);
  }
});

test('the manifest names icons that exist', () => {
  const manifest = JSON.parse(readFileSync(root('targets/web/manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(root(`public/${icon.src}`)), icon.src);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.src.includes('maskable')), 'a real maskable icon');
});
