import { randomBytes, randomInt } from 'node:crypto';

export function createAgentSecret() {
  return `fg_${randomBytes(32).toString('base64url')}`;
}

export function createTemporaryPortalPassword() {
  return String(randomInt(0, 100_000_000)).padStart(8, '0');
}
