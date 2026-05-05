import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, isHashedPassword, verifyPassword } from './passwords.js';

test('hashPassword stores a verifiable scrypt hash', () => {
  const password = 'SuperSecret123';
  const hashed = hashPassword(password);

  assert.equal(isHashedPassword(hashed), true);
  assert.equal(verifyPassword(password, hashed), true);
  assert.equal(verifyPassword('wrong-password', hashed), false);
});

