// Decide what importing (or logging in with) a set of credentials should do to
// the account list.
//
// The CLI and the TUI both add OAuth accounts, and they used to carry separate
// copies of these rules. The copies drifted: a fix applied to `teamclaude
// import` did not reach the TUI's [g] → Add account, so the same stale-token
// import behaved differently depending on which one you used.
//
// They cannot simply share a function that does the work, because the delivery
// genuinely differs — the CLI prints to stderr and exits, while the TUI appends
// to a log pane and must never kill the process, since it IS the running server,
// and it alone also updates a live AccountManager. So what is shared is the
// DECISION: this module returns a plan, and each caller carries it out its own
// way. The rules then live in one place, and are testable without a terminal or
// a running server.

import { sameIdentity, findUpsertTarget, orgLabel } from './identity.js';
import { isTokenRejection } from './oauth.js';

/**
 * Plan the effect of `creds` + `profile` on `accounts`.
 *
 * Returns one of:
 *   { action: 'reject', reason }
 *       The upstream rejected the credentials. Storing the account would save
 *       something that can never serve a request — and, with no accountUuid to
 *       identify it by, one a later good import cannot even repair.
 *   { action: 'update', index, account, previousName }
 *       Same account+org already on file: take the new credentials and org info,
 *       keep the existing display name and any disk-only fields.
 *   { action: 'add', account, renames }
 *       A new entry. `renames` lists existing entries that must gain an " (org)"
 *       suffix first, because they share an accountUuid with the incoming one and
 *       would otherwise collide on the same email-derived name.
 *
 * Every plan carries `notices`: ordered { level, text } lines for the caller to
 * surface however it surfaces things.
 */
export function planAccountUpsert({ accounts, name = null, creds, profile, source = 'unknown' }) {
  const notices = [];
  const profileOk = profile && !profile.error;

  if (!profileOk) {
    if (isTokenRejection(profile)) {
      return { action: 'reject', reason: profile.error, notices };
    }
    // Anything else (5xx, timeout, DNS) says nothing about the token itself, and
    // a healthy one must stay importable from a restricted network.
    notices.push({ level: 'warn', text: `could not fetch account profile — ${profile?.error || 'no token'}` });
  }

  // A name the user supplied is never rewritten for org disambiguation below.
  const userNamed = !!name;
  if (!name && profile?.email) {
    name = profile.email;
    const tier = profile.hasClaudeMax ? 'Max' : profile.hasClaudePro ? 'Pro' : null;
    if (tier) notices.push({ level: 'info', text: `Detected Claude ${tier} account: ${profile.email}` });
  }
  if (!name) {
    const n = accounts.filter(a => a.name.startsWith('account-')).length + 1;
    name = `account-${n}`;
  }

  const account = {
    name,
    type: 'oauth',
    source,
    accountUuid: profile?.accountUuid || null,
    orgUuid: profile?.orgUuid || null,
    orgName: profile?.orgName || null,
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  };

  // Deduplicate by account+org identity (same email in a different org is a
  // distinct account), then by name — but only where the name is not standing in
  // for a different account+org, which is exactly the multi-org case below.
  const index = findUpsertTarget(accounts, account);
  if (index >= 0) {
    return { action: 'update', index, account, previousName: accounts[index].name, notices };
  }

  // New org for this person: if another entry shares the accountUuid, the bare
  // email name would collide — disambiguate both with " (org)".
  const renames = [];
  if (!userNamed && account.accountUuid) {
    const collisions = accounts
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.accountUuid === account.accountUuid && !sameIdentity(a, account));
    if (collisions.length > 0) {
      for (const { a, i } of collisions) {
        if (!a.name.includes(' (')) renames.push({ index: i, name: `${a.name} (${orgLabel(a)})` });
      }
      account.name = `${name} (${orgLabel(account)})`;
    }
  }

  return { action: 'add', account, renames, notices };
}

/**
 * Apply an 'update' or 'add' plan to a plain accounts array. The credential and
 * naming rules are identical for both callers; only what they do BESIDES this
 * (log, exit, poke a live AccountManager) differs.
 */
export function applyAccountPlan(accounts, plan) {
  if (plan.action === 'update') {
    const prev = accounts[plan.index];
    accounts[plan.index] = { ...prev, ...plan.account, name: prev.name };
    return accounts[plan.index];
  }
  for (const r of plan.renames) accounts[r.index].name = r.name;
  accounts.push(plan.account);
  return plan.account;
}
