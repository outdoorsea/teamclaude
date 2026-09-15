import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importCredentials } from '../src/oauth.js';

const CREDS = { accessToken: 'at', refreshToken: 'rt', expiresAt: 1754500000000 };

async function tmpHome() {
  return mkdtemp(join(tmpdir(), 'tc-import-'));
}

test('reads nested claudeAiOauth credentials from file', async () => {
  const home = await tmpHome();
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: CREDS }));

  // Inject a failing reader: the default path on darwin consults the Keychain,
  // and this test is about the file, not about whatever this machine has stored.
  const readKeychain = async () => { throw new Error('no keychain in test'); };
  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'at');
  assert.equal(creds.refreshToken, 'rt');
});

test('reads flat credentials from file', async () => {
  const home = await tmpHome();
  await writeFile(join(home, 'creds.json'), JSON.stringify(CREDS));

  const creds = await importCredentials(join(home, 'creds.json'), { home, platform: 'linux' });
  assert.equal(creds.accessToken, 'at');
});

test('falls back to Keychain on macOS when default file is missing', async () => {
  const home = await tmpHome();
  let called = 0;
  const readKeychain = async () => { called++; return { claudeAiOauth: CREDS }; };

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(called, 1);
  assert.equal(creds.accessToken, 'at');
  assert.equal(creds.expiresAt, CREDS.expiresAt);
});

test('does not touch Keychain on non-macOS platforms', async () => {
  const home = await tmpHome();
  let called = 0;
  const readKeychain = async () => { called++; return { claudeAiOauth: CREDS }; };

  await assert.rejects(
    importCredentials('~/.claude/.credentials.json', { home, platform: 'linux', readKeychain }),
    (err) => err.code === 'ENOENT',
  );
  assert.equal(called, 0);
});

test('does not touch Keychain for a non-default path on macOS', async () => {
  const home = await tmpHome();
  let called = 0;
  const readKeychain = async () => { called++; return { claudeAiOauth: CREDS }; };

  await assert.rejects(
    importCredentials(join(home, 'other.json'), { home, platform: 'darwin', readKeychain }),
    (err) => err.code === 'ENOENT',
  );
  assert.equal(called, 0);
});

test('reports both file and Keychain failure when fallback fails', async () => {
  const home = await tmpHome();
  const readKeychain = async () => { throw new Error('item not found in keychain'); };

  await assert.rejects(
    importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain }),
    /Keychain.*item not found in keychain/,
  );
});

// ── freshness arbitration (the stale-file import bug) ──────────────────────
//
// A ~/.claude/.credentials.json left behind by an older Claude Code used to win
// on macOS purely by existing, importing tokens that had expired months earlier.

const HOUR = 3600 * 1000;
const fresh = { accessToken: 'fresh', refreshToken: 'fresh-rt', expiresAt: Date.now() + HOUR };
const stale = { accessToken: 'stale', refreshToken: 'stale-rt', expiresAt: Date.now() - 90 * 24 * HOUR };

async function withDefaultFile(creds) {
  const home = await tmpHome();
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: creds }));
  return home;
}

test('prefers a fresh Keychain over a stale leftover credentials file', async () => {
  const home = await withDefaultFile(stale);
  const readKeychain = async () => ({ claudeAiOauth: fresh });

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
  assert.match(creds.origin, /Keychain/);
});

test('prefers a fresh file over a stale Keychain entry', async () => {
  const home = await withDefaultFile(fresh);
  const readKeychain = async () => ({ claudeAiOauth: stale });

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
  assert.match(creds.origin, /\.credentials\.json$/);
});

test('breaks an expiry tie in favour of the Keychain', async () => {
  const home = await withDefaultFile({ ...stale, expiresAt: fresh.expiresAt });
  const readKeychain = async () => ({ claudeAiOauth: fresh });

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
});

test('compares expiry across seconds and milliseconds units', async () => {
  // Claude Code writes ms; an OAuth endpoint may hand back seconds. Compared raw,
  // any seconds value looks older than every ms value and would always lose.
  const home = await withDefaultFile(stale);
  const readKeychain = async () => ({ claudeAiOauth: { ...fresh, expiresAt: Math.floor(fresh.expiresAt / 1000) } });

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
});

test('falls back to the file when the Keychain read fails', async () => {
  const home = await withDefaultFile(fresh);
  const readKeychain = async () => { throw new Error('user denied keychain access'); };

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
});

test('falls back to the Keychain when the file is unreadable garbage', async () => {
  const home = await tmpHome();
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude', '.credentials.json'), 'not json at all');
  const readKeychain = async () => ({ claudeAiOauth: fresh });

  const creds = await importCredentials('~/.claude/.credentials.json', { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'fresh');
});

test('an explicit --from path never consults the Keychain, even when stale', async () => {
  const home = await tmpHome();
  await writeFile(join(home, 'explicit.json'), JSON.stringify(stale));
  let called = 0;
  const readKeychain = async () => { called++; return { claudeAiOauth: fresh }; };

  const creds = await importCredentials(join(home, 'explicit.json'), { home, platform: 'darwin', readKeychain });
  assert.equal(creds.accessToken, 'stale');
  assert.equal(called, 0);
});
