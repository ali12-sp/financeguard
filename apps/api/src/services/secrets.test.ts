import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSecret, createTemporaryPortalPassword } from './secrets.js';

test('createAgentSecret returns high-entropy URL-safe tokens', () => {
  const left = createAgentSecret();
  const right = createAgentSecret();

  assert.match(left, /^fg_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(left, right);
});

test('createTemporaryPortalPassword returns an 8 digit password', () => {
  assert.match(createTemporaryPortalPassword(), /^\d{8}$/);
});
