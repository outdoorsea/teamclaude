import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager } from '../src/account-manager.js';

// Per-model accounting. The server parses the model on every request; until
// this existed it reached the activity pane and nothing else, so nothing in the
// control plane could answer "what is this fleet actually running".

function oauth(name, extra = {}) {
  return { name, type: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000, ...extra };
}
const manager = () => new AccountManager([oauth('a'), oauth('b')], 0.98);

test('tokens are booked against the model as well as the totals', () => {
  const am = manager();
  am.updateUsage(0, 120, 0, 'claude-opus-5', true);
  am.updateUsage(0, 0, 45, 'claude-opus-5', false);
  am.updateUsage(0, 200, 60, 'claude-fable-5-1', true);

  const u = am.accounts[0].usage;
  assert.equal(u.totalInputTokens, 320);
  assert.equal(u.totalOutputTokens, 105);
  assert.deepEqual(
    { ...u.byModel['claude-opus-5'], lastUsed: null },
    { requests: 1, inputTokens: 120, outputTokens: 45, lastUsed: null });
  assert.deepEqual(
    { ...u.byModel['claude-fable-5-1'], lastUsed: null },
    { requests: 1, inputTokens: 200, outputTokens: 60, lastUsed: null });
});

test('a stream reports usage several times but counts as one request', () => {
  // message_start and every message_delta call updateUsage. Counting each would
  // report a multiple of the real traffic, which is the whole point of passing
  // countRequest separately rather than inferring it.
  const am = manager();
  am.updateUsage(0, 120, 0, 'claude-opus-5', true);      // message_start
  for (let i = 0; i < 5; i++) am.updateUsage(0, 0, 10, 'claude-opus-5', false); // deltas
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].requests, 1);
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].outputTokens, 50);
});

test('usage with no model still moves the totals and adds no row', () => {
  // A request whose model could not be parsed must not be lost from the totals,
  // and must not invent a model row to hold it.
  const am = manager();
  am.updateUsage(0, 10, 5);
  assert.equal(am.accounts[0].usage.totalInputTokens, 10);
  assert.deepEqual(Object.keys(am.accounts[0].usage.byModel), []);
});

test('per-account books stay separate, and an unknown index is ignored', () => {
  const am = manager();
  am.updateUsage(0, 100, 0, 'claude-opus-5', true);
  am.updateUsage(1, 7, 0, 'claude-opus-5', true);
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].inputTokens, 100);
  assert.equal(am.accounts[1].usage.byModel['claude-opus-5'].inputTokens, 7);
  assert.doesNotThrow(() => am.updateUsage(99, 1, 1, 'claude-opus-5', true));
});

test('a model name off the wire cannot reach an inherited property', () => {
  // The model string comes from the client's request body. A plain object would
  // resolve `__proto__` and `constructor` to something inherited, and the
  // accumulator would write through them instead of creating a row.
  const am = manager();
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    assert.doesNotThrow(() => am.updateUsage(0, 5, 5, evil, true));
    const row = am.accounts[0].usage.byModel[evil];
    assert.equal(typeof row, 'object', `${evil} is stored as an ordinary row`);
    assert.equal(row.inputTokens, 5);
  }
  assert.equal({}.polluted, undefined, 'nothing leaked onto Object.prototype');
  assert.equal(am.accounts[1].usage.byModel['__proto__'], undefined, 'and not onto a sibling account');
});

test('getStatus copies the breakdown rather than sharing the live counters', () => {
  const am = manager();
  am.updateUsage(0, 100, 20, 'claude-opus-5', true);

  const first = am.getStatus().accounts[0].usage;
  assert.equal(first.byModel['claude-opus-5'].inputTokens, 100);

  // Mutating what the control plane was handed must not reach the account.
  first.byModel['claude-opus-5'].inputTokens = 999_999;
  delete first.byModel['claude-opus-5'];
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].inputTokens, 100);

  // And a later read reflects real traffic, not the tampering.
  am.updateUsage(0, 1, 0, 'claude-opus-5', false);
  assert.equal(am.getStatus().accounts[0].usage.byModel['claude-opus-5'].inputTokens, 101);
});
