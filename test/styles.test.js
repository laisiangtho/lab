import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { root } from './helpers.js';

// A stray brace is not an error to a browser: it drops the rule after it and
// says nothing, which is how a narrow-screen rule went missing unnoticed.
test('every stylesheet has balanced braces', () => {
  for (const dir of ['app/styles', 'targets/web', 'targets/desktop']) {
    for (const name of readdirSync(root(dir)).filter((file) => file.endsWith('.css'))) {
      const css = readFileSync(root(`${dir}/${name}`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
      let depth = 0;
      css.split('\n').forEach((line, i) => {
        for (const ch of line) {
          if (ch === '{') depth += 1;
          if (ch === '}') depth -= 1;
          assert.ok(depth >= 0, `${dir}/${name}:${i + 1}: a closing brace with nothing open`);
        }
      });
      assert.equal(depth, 0, `${dir}/${name}: ${depth} brace(s) left open`);
    }
  }
});
