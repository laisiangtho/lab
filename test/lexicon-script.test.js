import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { glossOf, lookup, parseLexicon } from '../app/core/lexicon.js';
import { root } from './helpers.js';

const script = root('scripts/lexicon.mjs');
const hebrew = root('test/fixtures/originals/strongs-hebrew-dictionary-extract.js');
const greek = root('test/fixtures/originals/strongs-greek-dictionary-extract.js');
const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('a dry run writes nothing and says what it would', () => {
  const said = run(hebrew, greek);
  assert.match(said, /strongs-h\.json: 6 entries/);
  assert.match(said, /strongs-g\.json: 5 entries/);
  assert.match(said, /dry run: nothing written/);
});

test('--apply without --out is refused, by name', () => {
  assert.throws(() => execFileSync(process.execPath, [script, hebrew, greek, '--apply'], { stdio: 'pipe' }), /--apply needs --out/);
});

test("Strong's dictionaries become the files the app fetches", () => {
  const out = mkdtempSync(join(tmpdir(), 'lexicon-'));
  run(hebrew, greek, '--out', out, '--apply');
  const h = JSON.parse(readFileSync(join(out, 'strongs-h.json'), 'utf8'));
  const g = JSON.parse(readFileSync(join(out, 'strongs-g.json'), 'utf8'));
  assert.match(h.source, /public domain/);
  assert.match(h.licence, /CC BY-SA/);
  assert.ok(h.changes.length > 40, 'what was changed is said, as the licence asks');
  const held = { H: parseLexicon(h, { source: 'h' }), G: parseLexicon(g, { source: 'g' }) };
  assert.equal(lookup(held, 'H430').entry.lemma.normalize('NFC'), 'אֱלֹהִים'.normalize('NFC'));
  assert.equal(lookup(held, 'H1254A').entry.gloss, 'to create', 'a sense letter finds the plain number');
  assert.match(lookup(held, 'H1').entry.define, /^father.*\na primitive word;$/s, 'the definition, then where the word came from');
  // θεός: the edition files "a deity … the supreme Divinity" with the
  // derivation; it is put back at the head of the definition.
  const theos = lookup(held, 'G2316').entry;
  assert.match(theos.define, /^a deity, especially/);
  assert.match(theos.define, /\nof uncertain affinity;$/);
  assert.equal(glossOf(theos), 'a deity');
  assert.equal(glossOf(lookup(held, 'G1510').entry), 'I exist', 'etymology left where it was, brackets off the gloss');
  assert.equal(glossOf(lookup(held, 'H853').entry), 'self');
  assert.doesNotMatch(lookup(held, 'G26').entry.kjv, /^:?--/);
});
