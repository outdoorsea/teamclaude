import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAccountUpsert, applyAccountPlan } from '../src/account-upsert.js';

// The CLI and the TUI used to carry separate copies of these rules, and they
// drifted. These cover the shared decision itself, with no terminal and no
// running server involved.

const creds = { accessToken: 'at', refreshToken: 'rt', expiresAt: 1800000000000 };
const profile = { email: 'a@x.com', accountUuid: 'u1', orgUuid: 'o-acme', orgName: 'Acme' };

test('rejects credentials the upstream turned down', () => {
  const plan = planAccountUpsert({
    accounts: [], creds, source: 'import',
    profile: { error: 'HTTP 401: expired', status: 401 },
  });
  assert.equal(plan.action, 'reject');
  assert.match(plan.reason, /401/);
});

test('an unreachable profile endpoint still adds, with a warning', () => {
  // The token may be perfectly good; a restricted network must not block import.
  const plan = planAccountUpsert({
    accounts: [], creds, source: 'import',
    profile: { error: 'fetch failed' },
  });
  assert.equal(plan.action, 'add');
  assert.equal(plan.notices.filter(n => n.level === 'warn').length, 1);
  assert.equal(plan.account.accountUuid, null);
});

test('names a new account from the profile email', () => {
  const plan = planAccountUpsert({ accounts: [], creds, profile, source: 'import' });
  assert.equal(plan.action, 'add');
  assert.equal(plan.account.name, 'a@x.com');
  assert.equal(plan.account.source, 'import');
  assert.equal(plan.account.accessToken, 'at');
});

test('falls back to account-N when there is no email', () => {
  const accounts = [{ name: 'account-1' }, { name: 'other' }];
  const plan = planAccountUpsert({ accounts, creds, profile: { error: 'fetch failed' }, source: 'import' });
  assert.equal(plan.account.name, 'account-2');
});

test('updates in place when the same account+org is already on file', () => {
  const accounts = [{ name: 'my-main', type: 'oauth', accountUuid: 'u1', orgUuid: 'o-acme', orgName: 'Acme' }];
  const plan = planAccountUpsert({ accounts, creds, profile, source: 'import' });
  assert.equal(plan.action, 'update');
  assert.equal(plan.index, 0);
  assert.equal(plan.previousName, 'my-main');

  applyAccountPlan(accounts, plan);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, 'my-main');      // display name survives
  assert.equal(accounts[0].accessToken, 'at');    // credentials refreshed
});

test('a second org for one person is added, and both names gain an org suffix', () => {
  const accounts = [{ name: 'a@x.com', type: 'oauth', accountUuid: 'u1', orgUuid: 'o-personal', orgName: 'Personal' }];
  const plan = planAccountUpsert({ accounts, creds, profile, source: 'import' });

  assert.equal(plan.action, 'add');
  assert.deepEqual(plan.renames, [{ index: 0, name: 'a@x.com (Personal)' }]);
  assert.equal(plan.account.name, 'a@x.com (Acme)');

  applyAccountPlan(accounts, plan);
  assert.deepEqual(accounts.map(a => a.name), ['a@x.com (Personal)', 'a@x.com (Acme)']);
});

test('a user-supplied name is never rewritten for org disambiguation', () => {
  const accounts = [{ name: 'a@x.com', type: 'oauth', accountUuid: 'u1', orgUuid: 'o-personal', orgName: 'Personal' }];
  const plan = planAccountUpsert({ accounts, name: 'work', creds, profile, source: 'login' });
  assert.equal(plan.account.name, 'work');
  assert.deepEqual(plan.renames, []);
});

test('announces a detected subscription tier', () => {
  const plan = planAccountUpsert({
    accounts: [], creds, source: 'import',
    profile: { ...profile, hasClaudeMax: true },
  });
  assert.ok(plan.notices.some(n => n.level === 'info' && /Max/.test(n.text)));
});

test('a rejection short-circuits before any naming or renaming is planned', () => {
  const accounts = [{ name: 'a@x.com', type: 'oauth', accountUuid: 'u1', orgUuid: 'o-personal' }];
  const plan = planAccountUpsert({
    accounts, creds, source: 'import',
    profile: { error: 'HTTP 403: revoked', status: 403 },
  });
  assert.equal(plan.action, 'reject');
  assert.equal(plan.account, undefined);
  assert.equal(accounts[0].name, 'a@x.com'); // untouched
});
