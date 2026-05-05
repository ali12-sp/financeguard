import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PASSWORD_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const digest = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${PASSWORD_PREFIX}$${salt}$${digest}`;
}

export function isHashedPassword(password: string) {
  return password.startsWith(`${PASSWORD_PREFIX}$`);
}

export function verifyPassword(password: string, storedPassword: string) {
  if (!isHashedPassword(storedPassword)) {
    return storedPassword === password;
  }

  const [, salt, digest] = storedPassword.split('$');
  if (!salt || !digest) {
    return false;
  }

  const derived = scryptSync(password, salt, KEY_LENGTH);
  const storedDigest = Buffer.from(digest, 'hex');

  if (derived.byteLength !== storedDigest.byteLength) {
    return false;
  }

  return timingSafeEqual(derived, storedDigest);
}

