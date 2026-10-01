import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeMorph, morphLine } from '../../app/core/morph.js';
import * as tables from '../../app/core/morph-data.js';

test('Hebrew: every part of a compound code, from the codes in the WLC fixture', () => {
  assert.equal(morphLine('HVqp3ms', tables), 'Verb : Qal (Simple, Active) Perfect (Past/present Indicative) Third Singular Masculine');
  assert.equal(morphLine('HNcmpa', tables), 'Noun (Plural Masculine, Absolute)');
  const prefixed = describeMorph('HR/Ncfsa', tables);
  assert.equal(prefixed.known, true);
  assert.deepEqual(prefixed.parts.map((p) => p.code), ['R', 'Ncfsa']);
  assert.match(morphLine('HTd/Ncmpa', tables), /Article.*\+ Noun/i);
  assert.match(morphLine('HC/To', tables), /^Conjunction \+ /);
});

test('Greek: Robinson codes, with or without a scheme prefix', () => {
  assert.equal(morphLine('V-PAI-3S', tables), 'Verb Present Active Indicative 3rd Singular');
  assert.equal(morphLine('robinson:N-NSM', tables), 'Noun Nominative Singular Masculine');
});

test('a code no table reads comes back as itself, not as a guess', () => {
  const kjv = describeMorph('strongMorph:TH8804', tables);
  assert.equal(kjv.known, false);
  assert.equal(morphLine('strongMorph:TH8804', tables), 'strongMorph:TH8804');
  assert.equal(morphLine('X-NOTHING', tables), 'X-NOTHING');
});
