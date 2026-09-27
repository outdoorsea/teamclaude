import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager } from '../src/account-manager.js';

// Per-model accounting. recordTokenUsage books each message once, with its
// settled figures, so the per-model rows answer "what is this fleet actually
// running" without a stream's several usage events inflating the count.

function oauth(name, extra = {}) {
  return { name, type: 'oauth', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600_000, ...extra };
}
const manager = () => new AccountManager([oauth('a'), oauth('b')], 0.98);
const usage = (input, output, extra = {}) => ({ input_tokens: input, output_tokens: output, ...extra });
const row = r => ({ ...r, lastUsed: null });

test('each message is booked against its model, once', () => {
  const am = manager();
  am.recordTokenUsage(0, 's1', 'claude-opus-5', usage(120, 45, { cache_read_input_tokens: 1000 }));
  am.recordTokenUsage(0, 's1', 'claude-opus-5', usage(10, 5));
  am.recordTokenUsage(0, 's1', 'claude-fable-5-1', usage(200, 60));

  const by = am.accounts[0].usage.byModel;
  assert.deepEqual(row(by['claude-opus-5']),
    { requests: 2, inputTokens: 130, outputTokens: 50, cacheReadTokens: 1000, cacheCreationTokens: 0, lastUsed: null });
  assert.deepEqual(row(by['claude-fable-5-1']),
    { requests: 1, inputTokens: 200, outputTokens: 60, cacheReadTokens: 0, cacheCreationTokens: 0, lastUsed: null });
});

test('a usage report with no model adds no row', () => {
  const am = manager();
  am.recordTokenUsage(0, null, null, usage(10, 5));
  am.recordTokenUsage(0, null, '', usage(10, 5));
  assert.deepEqual(Object.keys(am.accounts[0].usage.byModel), []);
});

test('per-account books stay separate, and an unknown index is ignored', () => {
  const am = manager();
  am.recordTokenUsage(0, null, 'claude-opus-5', usage(100, 0));
  am.recordTokenUsage(1, null, 'claude-opus-5', usage(7, 0));
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].inputTokens, 100);
  assert.equal(am.accounts[1].usage.byModel['claude-opus-5'].inputTokens, 7);
  assert.doesNotThrow(() => am.recordTokenUsage(99, null, 'claude-opus-5', usage(1, 1)));
});

test('a model name off the wire cannot reach an inherited property', () => {
  // The model string comes from the client's request body. A plain object would
  // resolve `__proto__` and `constructor` to something inherited, and the
  // accumulator would write through them instead of creating a row.
  const am = manager();
  for (const evil of ['__proto__', 'constructor', 'toString']) {
    assert.doesNotThrow(() => am.recordTokenUsage(0, null, evil, usage(5, 5)));
    const r = am.accounts[0].usage.byModel[evil];
    assert.equal(typeof r, 'object', `${evil} is stored as an ordinary row`);
    assert.equal(r.inputTokens, 5);
  }
  assert.equal({}.polluted, undefined, 'nothing leaked onto Object.prototype');
  assert.equal(am.accounts[1].usage.byModel['__proto__'], undefined, 'and not onto a sibling account');

  // The status copy keeps `__proto__` as a row, not as the copy's prototype.
  const copied = am.getStatus().accounts[0].usage.byModel;
  assert.ok(Object.hasOwn(copied, '__proto__'));
  assert.equal(copied['__proto__'].inputTokens, 5);
});

test('getStatus copies the breakdown rather than sharing the live counters', () => {
  const am = manager();
  am.recordTokenUsage(0, null, 'claude-opus-5', usage(100, 20));

  const first = am.getStatus().accounts[0].usage;
  assert.equal(first.byModel['claude-opus-5'].inputTokens, 100);

  // Mutating what the control plane was handed must not reach the account.
  first.byModel['claude-opus-5'].inputTokens = 999_999;
  delete first.byModel['claude-opus-5'];
  assert.equal(am.accounts[0].usage.byModel['claude-opus-5'].inputTokens, 100);

  // And a later read reflects real traffic, not the tampering.
  am.recordTokenUsage(0, null, 'claude-opus-5', usage(1, 0));
  assert.equal(am.getStatus().accounts[0].usage.byModel['claude-opus-5'].inputTokens, 101);
});
