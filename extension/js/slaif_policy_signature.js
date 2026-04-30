const SIGNED_POLICY_TYPE = 'slaif.signedHpcPolicy';
const POLICY_TRUST_ROOTS_TYPE = 'slaif.policyTrustRoots';
const SUPPORTED_ALGORITHM = 'ECDSA-P256-SHA256';

async function getSubtleCrypto() {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  const {webcrypto} = await import('node:crypto');
  return webcrypto.subtle;
}

function textEncoder() {
  return new TextEncoder();
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' ||
      typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonical JSON does not support non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error(`canonical JSON does not support ${typeof value}`);
}

export function unsignedPolicyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('signed policy envelope must be an object');
  }
  const {signature: _signature, ...unsigned} = envelope;
  return unsigned;
}

export function canonicalPolicySigningInput(envelope) {
  return canonicalJson(unsignedPolicyEnvelope(envelope));
}

export function base64urlEncode(bytes) {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join('');
  const base64 = typeof btoa === 'function' ?
    btoa(binary) :
    Buffer.from(binary, 'binary').toString('base64');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64urlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('invalid base64url value');
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

export function base64Decode(value, name = 'base64 value') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    throw new Error(`${name} must be base64`);
  }
  const normalized = value.replace(/\s+/g, '');
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(normalized, 'base64'));
}

export function validateTrustRoots(trustRoots) {
  if (!trustRoots || typeof trustRoots !== 'object' || Array.isArray(trustRoots)) {
    throw new Error('policy trust roots must be an object');
  }
  if (trustRoots.type !== POLICY_TRUST_ROOTS_TYPE || trustRoots.version !== 1) {
    throw new Error('unsupported policy trust roots');
  }
  if (!Array.isArray(trustRoots.keys) || trustRoots.keys.length === 0) {
    throw new Error('policy trust roots must include keys');
  }
  const keys = new Map();
  for (const key of trustRoots.keys) {
    if (!key || typeof key !== 'object' || Array.isArray(key)) {
      throw new Error('policy trust root key must be an object');
    }
    if (typeof key.keyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(key.keyId)) {
      throw new Error('policy trust root keyId is invalid');
    }
    if (key.algorithm !== SUPPORTED_ALGORITHM) {
      throw new Error(`unsupported policy trust root algorithm: ${key.algorithm}`);
    }
    if (typeof key.publicKeySpkiBase64 !== 'string') {
      throw new Error(`policy trust root ${key.keyId} missing publicKeySpkiBase64`);
    }
    if (keys.has(key.keyId)) {
      throw new Error(`duplicate policy trust root keyId: ${key.keyId}`);
    }
    keys.set(key.keyId, key);
  }
  return keys;
}

export function validateSignedPolicyEnvelopeShape(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('signed policy envelope must be an object');
  }
  if (envelope.type !== SIGNED_POLICY_TYPE || envelope.version !== 1) {
    throw new Error('unsupported signed policy envelope');
  }
  if (envelope.algorithm !== SUPPORTED_ALGORITHM) {
    throw new Error(`unsupported signed policy algorithm: ${envelope.algorithm}`);
  }
  if (typeof envelope.keyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(envelope.keyId)) {
    throw new Error('signed policy keyId is invalid');
  }
  if (typeof envelope.signedAt !== 'string' || !Number.isFinite(Date.parse(envelope.signedAt))) {
    throw new Error('signed policy signedAt must be an ISO timestamp');
  }
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    throw new Error('signed policy payload must be an object');
  }
  if (typeof envelope.signature !== 'string' || !envelope.signature) {
    throw new Error('signed policy signature missing');
  }
}

export async function importPolicyPublicKey(key) {
  const subtle = await getSubtleCrypto();
  const spki = base64Decode(key.publicKeySpkiBase64, 'publicKeySpkiBase64');
  return subtle.importKey(
      'spki',
      spki,
      {name: 'ECDSA', namedCurve: 'P-256'},
      false,
      ['verify'],
  );
}

export async function verifySignedPolicyEnvelope(envelope, trustRoots) {
  validateSignedPolicyEnvelopeShape(envelope);
  const keys = validateTrustRoots(trustRoots);
  const trustRoot = keys.get(envelope.keyId);
  if (!trustRoot) {
    throw new Error(`unknown policy signing key: ${envelope.keyId}`);
  }
  if (trustRoot.algorithm !== envelope.algorithm) {
    throw new Error('policy signing key algorithm mismatch');
  }

  const subtle = await getSubtleCrypto();
  const publicKey = await importPolicyPublicKey(trustRoot);
  const signature = base64urlDecode(envelope.signature);
  const bytes = textEncoder().encode(canonicalPolicySigningInput(envelope));
  const ok = await subtle.verify(
      {name: 'ECDSA', hash: 'SHA-256'},
      publicKey,
      signature,
      bytes,
  );
  if (!ok) {
    throw new Error('signed HPC policy signature verification failed');
  }
  return envelope.payload;
}

export async function policyFingerprint(envelope) {
  const subtle = await getSubtleCrypto();
  const digest = await subtle.digest(
      'SHA-256',
      textEncoder().encode(canonicalPolicySigningInput(envelope)),
  );
  return base64urlEncode(digest);
}

export function evaluatePolicyRollback({policyId, sequence, fingerprint}, previous) {
  if (!previous || previous.policyId !== policyId) {
    return;
  }
  if (Number(previous.sequence) > sequence) {
    throw new Error('signed policy rollback rejected');
  }
  if (Number(previous.sequence) === sequence &&
      previous.fingerprint &&
      previous.fingerprint !== fingerprint) {
    throw new Error('signed policy sequence reuse with different fingerprint rejected');
  }
}

export {SIGNED_POLICY_TYPE, POLICY_TRUST_ROOTS_TYPE, SUPPORTED_ALGORITHM};
