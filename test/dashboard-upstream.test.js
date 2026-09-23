import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  renderDashboardHtml,
  inlineScripts,
  dashboardCsp,
  accountHolds,
  availabilityAt,
  formatCountdown,
  groupAccounts,
  modelRows,
  accountControlRequest,
  accountControlOutcome,
} from '../src/dashboard-upstream.js';

// The page this fork serves at /teamclaude/dashboard. Its pure logic is
// exported so it can be driven directly: the same functions are serialized into
// the page, so a test here is a test of what actually runs in the browser.

const NOW = 1_700_000_000_000;
const T = 0.98;                       // the fleet switchThreshold these tests assume
const soon = NOW + 90 * 1000;
const later = NOW + 3 * 3600 * 1000;

// ── holds ───────────────────────────────────────────────────────────────────

test('a weekly bucket holds only the models it governs', () => {
  // The server checks the weekly bucket GOVERNING the model, so an account out
  // of its general weekly still serves Fable from the Fable bucket. Treating
  // any spent window as "unavailable" contradicts the routing table, which
  // lists that same account as eligible for Fable.
  const rentals = {
    quota: {
      unified7d: 1, unified7dReset: later,
      unified7dFable: 0.4, unified7dFableReset: later,
    },
  };
  const holds = accountHolds(rentals, NOW, T);
  assert.deepEqual(holds.map(h => h.scope), ['general']);
  assert.equal(availabilityAt(rentals, NOW, T), null, 'still serves something, so not unavailable');

  const fableOut = {
    quota: {
      unified7d: 0.2, unified7dReset: later,
      unified7dFable: 1, unified7dFableReset: later,
    },
  };
  assert.deepEqual(accountHolds(fableOut, NOW, T).map(h => h.scope), ['fable']);
  assert.equal(availabilityAt(fableOut, NOW, T), null);
});

test('a spent general weekly holds everything when no family bucket exists', () => {
  // Nothing meters its own weekly here, so the general bucket is what governs
  // every model and the account really is out of the pool.
  const a = { quota: { unified7d: 1, unified7dReset: later } };
  assert.deepEqual(accountHolds(a, NOW, T).map(h => h.scope), ['all']);
  assert.ok(availabilityAt(a, NOW, T));
});

test('the shared 5h bucket, a pause and a 429 hold every model', () => {
  for (const account of [
    { quota: { unified5h: 1, unified5hReset: soon } },
    { pausedUntil: soon },
    { rateLimitedUntil: soon },
  ]) {
    const hold = availabilityAt(account, NOW, T);
    assert.ok(hold, 'blocks every model');
    assert.equal(hold.at, soon);
  }
});

test('holds are measured against the configured threshold, not 100%', () => {
  // The threshold is where the proxy STOPS SELECTING the account, so it is
  // already out of rotation whatever the upstream would still accept.
  const at98 = { quota: { unified5h: 0.98, unified5hReset: soon } };
  const at97 = { quota: { unified5h: 0.97, unified5hReset: soon } };
  assert.ok(availabilityAt(at98, NOW, 0.98));
  assert.equal(availabilityAt(at97, NOW, 0.98), null);
  // A fleet with a lower threshold pulls accounts out earlier.
  assert.ok(availabilityAt(at97, NOW, 0.9));
  // No threshold given falls back to the server's own default.
  assert.ok(availabilityAt(at98, NOW, undefined));
});

test('ISO-string timestamps are parsed, not compared as numbers', () => {
  // getStatus sends rateLimitedUntil and pausedUntil as ISO strings while the
  // quota resets are epoch numbers. Compared as numbers a string is quietly
  // always false, and the hold was never once reported.
  const iso = new Date(soon).toISOString();
  const holds = accountHolds({ rateLimitedUntil: iso }, NOW, T);
  assert.equal(holds.length, 1, 'the 429 hold is seen');
  assert.equal(holds[0].at, soon, 'and carries a usable timestamp');
  assert.equal(accountHolds({ pausedUntil: iso }, NOW, T).length, 1);
});

test('a hold that has already passed is not a hold', () => {
  const past = NOW - 1000;
  assert.deepEqual(accountHolds({ rateLimitedUntil: past, quota: { unified5h: 1, unified5hReset: past } }, NOW, T), []);
  assert.equal(availabilityAt({}, NOW, T), null);
  assert.equal(availabilityAt(null, NOW, T), null);
});

test('the soonest blocking hold is the one reported', () => {
  const a = {
    rateLimitedUntil: later,
    quota: { unified5h: 1, unified5hReset: soon },
  };
  assert.equal(availabilityAt(a, NOW, T).at, soon, 'the account is back when the LAST hold lifts');
});

// ── grouping ────────────────────────────────────────────────────────────────

test('grouping is stable and disabled beats held', () => {
  const accounts = [
    { name: 'live-1' },
    { name: 'held', quota: { unified5h: 1, unified5hReset: soon } },
    { name: 'live-2' },
    { name: 'off', disabled: true },
    // Disabled AND out of quota: the operator turned it off, and that is the
    // fact that decides what they do next.
    { name: 'off-and-spent', disabled: true, quota: { unified5h: 1, unified5hReset: soon } },
    // Out of Fable only — still in the pool, so it stays with the live ones.
    { name: 'fable-only', quota: { unified7dFable: 1, unified7dFableReset: soon } },
  ];
  const g = groupAccounts(accounts, NOW, T);
  assert.deepEqual(g.live.map(a => a.name), ['live-1', 'live-2', 'fable-only']);
  assert.deepEqual(g.held.map(a => a.name), ['held']);
  assert.deepEqual(g.off.map(a => a.name), ['off', 'off-and-spent']);
});

test('grouping tolerates an absent or empty account list', () => {
  for (const input of [null, undefined, []]) {
    assert.deepEqual(groupAccounts(input, NOW, T), { live: [], held: [], off: [] });
  }
});

// ── countdown ───────────────────────────────────────────────────────────────

test('the countdown coarsens as the wait lengthens', () => {
  assert.equal(formatCountdown(45 * 1000), '45s');
  assert.equal(formatCountdown(90 * 1000), '1m 30s');
  assert.equal(formatCountdown(3.5 * 3600 * 1000), '3h 30m');
  assert.equal(formatCountdown(50 * 3600 * 1000), '2d 2h');
  // Past, zero and nonsense all read as "now" rather than a negative clock.
  assert.equal(formatCountdown(0), 'now');
  assert.equal(formatCountdown(-5000), 'now');
  assert.equal(formatCountdown(NaN), 'now');
});

// ── per-model usage ─────────────────────────────────────────────────────────

test('modelRows sorts by spend and tolerates a missing breakdown', () => {
  const rows = modelRows({
    byModel: {
      'claude-fable-5-1': { requests: 9, inputTokens: 10, outputTokens: 5 },
      'claude-opus-5': { requests: 2, inputTokens: 300, outputTokens: 100 },
    },
  });
  assert.deepEqual(rows.map(r => r.model), ['claude-opus-5', 'claude-fable-5-1']);
  assert.equal(rows[0].tokens, 400);
  assert.equal(rows[1].requests, 9);
  // An account that has served nothing this session has no rows, not a row of
  // zeroes — the counters start at process start.
  assert.deepEqual(modelRows({}), []);
  assert.deepEqual(modelRows(null), []);
  assert.deepEqual(modelRows({ byModel: {} }), []);
});

// ── account controls ────────────────────────────────────────────────────────

test('accountControlRequest picks the endpoint and body from the spec', () => {
  const first = accountControlRequest('a@x.com', { place: 'first' }, 'k');
  assert.equal(first.url, '/teamclaude/priority');
  assert.deepEqual(JSON.parse(first.init.body), { account: 'a@x.com', place: 'first' });

  // disabled:false is a real value, not an absent one: it must still route to
  // the disable endpoint rather than read as a priority change.
  const on = accountControlRequest('a@x.com', { disabled: false }, 'k');
  assert.equal(on.url, '/teamclaude/disable');
  assert.deepEqual(JSON.parse(on.init.body), { account: 'a@x.com', disabled: false });
});

test('accountControlOutcome reports the number a relative move landed on', () => {
  assert.deepEqual(
    accountControlOutcome({ ok: true, name: 'a', priority: -1 }, { place: 'first' }),
    { kind: 'ok', text: 'a priority -1' });
  assert.deepEqual(
    accountControlOutcome({ ok: false, error: 'no account matches "z"' }, { place: 'first' }),
    { kind: 'error', text: 'change failed: no account matches "z"' });
});

// ── the page itself ─────────────────────────────────────────────────────────

test('the CSP admits every inline script by hash', () => {
  const html = renderDashboardHtml();
  const scripts = inlineScripts(html);
  // The theme is applied by a script in <head> so the page does not paint dark
  // and then flip; a policy covering only the first script would block it.
  assert.ok(scripts.length >= 2, 'a head script and a main script');
  const csp = dashboardCsp(html);
  for (const script of scripts) {
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    assert.match(csp, new RegExp(`'sha256-${hash.replace(/[+/=]/g, '\\$&')}'`));
  }
  assert.match(csp, /(^|; )default-src 'none'(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
});

test('the page is self-contained: nothing is loaded from off-box', () => {
  const html = renderDashboardHtml();
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/i);
});

test('the page carries the controls and sections this fork added', () => {
  const html = renderDashboardHtml();
  for (const needle of ['id="theme"', 'id="currentWrap"', 'id="heldWrap"', 'id="offWrap"']) {
    assert.ok(html.includes(needle), `page is missing ${needle}`);
  }
  // A backtick inside the page's template literal terminates it; this has
  // broken the build three times, so the shape is pinned here.
  const src = html.slice(html.indexOf('<script>'));
  assert.ok(src.length > 0);
});
