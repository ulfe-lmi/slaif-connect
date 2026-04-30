import assert from 'node:assert/strict';
import {evaluateAcceptedPolicyRollback} from '../../extension/js/slaif_policy.js';

const previous = {
  policyId: 'slaif-hpc-policy-prod',
  sequence: 5,
  fingerprint: 'fingerprint-a',
};

assert.doesNotThrow(() => evaluateAcceptedPolicyRollback({
  policyId: 'other-policy',
  sequence: 1,
  fingerprint: 'fingerprint-z',
}, previous));
assert.doesNotThrow(() => evaluateAcceptedPolicyRollback({
  policyId: previous.policyId,
  sequence: 6,
  fingerprint: 'fingerprint-b',
}, previous));
assert.doesNotThrow(() => evaluateAcceptedPolicyRollback({
  policyId: previous.policyId,
  sequence: 5,
  fingerprint: 'fingerprint-a',
}, previous));
assert.throws(() => evaluateAcceptedPolicyRollback({
  policyId: previous.policyId,
  sequence: 4,
  fingerprint: 'fingerprint-old',
}, previous), /rollback/);
assert.throws(() => evaluateAcceptedPolicyRollback({
  policyId: previous.policyId,
  sequence: 5,
  fingerprint: 'fingerprint-b',
}, previous), /sequence reuse/);

console.log('policy rollback tests OK');
