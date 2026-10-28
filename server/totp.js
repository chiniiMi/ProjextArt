import { createHmac, timingSafeEqual } from 'node:crypto';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totpPeriodSeconds = 30;

export function decodeBase32Secret(secret) {
  const normalizedSecret = secret.toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]+$/.test(normalizedSecret)) {
    throw new Error('TOTP_SECRET must be a Base32 string.');
  }

  let bitBuffer = 0;
  let bitCount = 0;
  const secretBytes = [];
  for (const character of normalizedSecret) {
    bitBuffer = (bitBuffer << 5) | base32Alphabet.indexOf(character);
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      secretBytes.push((bitBuffer >> bitCount) & 0xff);
      bitBuffer &= (1 << bitCount) - 1;
    }
  }

  if (bitCount > 0 && (bitBuffer & ((1 << bitCount) - 1)) !== 0) {
    throw new Error('TOTP_SECRET is not valid Base32.');
  }

  const decodedSecret = Buffer.from(secretBytes);
  if (decodedSecret.length < 20) {
    throw new Error('TOTP_SECRET must decode to at least 20 bytes.');
  }
  return decodedSecret;
}

function createTotpCode(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binaryCode % 1_000_000).padStart(6, '0');
}

export function findValidTotpCounter(secret, providedCode, now = Date.now(), lastAcceptedCounter = -1) {
  if (!/^\d{6}$/.test(providedCode || '')) return null;

  const currentCounter = Math.floor(now / (totpPeriodSeconds * 1000));
  let acceptedCounter = null;
  for (let offset = -1; offset <= 1; offset += 1) {
    const counter = currentCounter + offset;
    if (counter < 0) continue;

    const expectedCode = Buffer.from(createTotpCode(secret, counter));
    const candidateCode = Buffer.from(providedCode);
    if (timingSafeEqual(expectedCode, candidateCode) && counter > lastAcceptedCounter) {
      acceptedCounter = counter;
    }
  }
  return acceptedCounter;
}
