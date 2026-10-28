import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBase32Secret, findValidTotpCounter } from './totp.js';

const rfc6238Sha1Secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('decodes Base32 secrets', () => {
  assert.equal(
    decodeBase32Secret(rfc6238Sha1Secret).toString(),
    '12345678901234567890',
  );
});

test('accepts the six-digit RFC 6238 SHA-1 test code', () => {
  assert.equal(findValidTotpCounter(decodeBase32Secret(rfc6238Sha1Secret), '287082', 59_000), 1);
});

test('accepts the adjacent time window and rejects reused counters', () => {
  const secret = decodeBase32Secret(rfc6238Sha1Secret);
  assert.equal(findValidTotpCounter(secret, '287082', 60_000), 1);
  assert.equal(findValidTotpCounter(secret, '287082', 60_000, 1), null);
});

test('rejects malformed or undersized Base32 secrets and invalid codes', () => {
  assert.throws(() => decodeBase32Secret('INVALID0'));
  assert.throws(() => decodeBase32Secret('MY'));
  assert.equal(findValidTotpCounter(decodeBase32Secret(rfc6238Sha1Secret), '12345', 59_000), null);
});
