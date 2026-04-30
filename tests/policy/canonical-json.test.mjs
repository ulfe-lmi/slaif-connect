import assert from 'node:assert/strict';
import {canonicalJson} from '../../extension/js/slaif_policy_signature.js';

assert.equal(
    canonicalJson({b: 2, a: {d: 4, c: 3}, e: [3, {g: true, f: null}]}),
    canonicalJson({e: [3, {f: null, g: true}], a: {c: 3, d: 4}, b: 2}),
);
assert.equal(canonicalJson({z: undefined, a: 1}), '{"a":1}');
assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
assert.throws(() => canonicalJson(() => {}), /does not support/);

console.log('canonical JSON tests OK');
