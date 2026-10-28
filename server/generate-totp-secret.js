import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const randomSecret = randomBytes(20);
let buffer = 0;
let bitsAvailable = 0;
let base32Secret = '';

for (const byte of randomSecret) {
  buffer = (buffer << 8) | byte;
  bitsAvailable += 8;
  while (bitsAvailable >= 5) {
    bitsAvailable -= 5;
    base32Secret += alphabet[(buffer >> bitsAvailable) & 0x1f];
    buffer &= (1 << bitsAvailable) - 1;
  }
}

if (bitsAvailable > 0) {
  base32Secret += alphabet[(buffer << (5 - bitsAvailable)) & 0x1f];
}

console.log(base32Secret);
