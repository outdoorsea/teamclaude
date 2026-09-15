import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenRejection } from '../src/oauth.js';

// An import whose profile fetch fails used to be saved anyway, storing an
// account that could never serve a request. Only a rejection proves that; an
// unreachable endpoint proves nothing and must stay importable.

test('a rejected token is proof the credentials are dead', () => {
  assert.equal(isTokenRejection({ error: 'HTTP 401: OAuth access token has expired', status: 401 }), true);
  assert.equal(isTokenRejection({ error: 'HTTP 403: forbidden', status: 403 }), true);
});

test('an unreachable endpoint is not proof of anything', () => {
  // 5xx: the upstream is broken, not the token.
  assert.equal(isTokenRejection({ error: 'HTTP 500: internal error', status: 500 }), false);
  assert.equal(isTokenRejection({ error: 'HTTP 502: bad gateway', status: 502 }), false);
  // 429: rate limited, and the token is fine.
  assert.equal(isTokenRejection({ error: 'HTTP 429: slow down', status: 429 }), false);
});

test('a network failure carries no status and is not a rejection', () => {
  // This is the restricted-network import that must keep working.
  assert.equal(isTokenRejection({ error: 'fetch failed' }), false);
  assert.equal(isTokenRejection({ error: 'getaddrinfo ENOTFOUND api.anthropic.com' }), false);
});

test('a successful or absent profile is never a rejection', () => {
  assert.equal(isTokenRejection({ email: 'user@example.com', accountUuid: 'u' }), false);
  assert.equal(isTokenRejection(null), false);
  assert.equal(isTokenRejection(undefined), false);
});

test('the status is read structurally, not parsed from the message', () => {
  // A message that merely mentions 401 is not a rejection without the status,
  // and a real rejection is caught even when the message says nothing about it.
  assert.equal(isTokenRejection({ error: 'upstream said 401 somewhere' }), false);
  assert.equal(isTokenRejection({ error: 'rejected', status: 401 }), true);
});
