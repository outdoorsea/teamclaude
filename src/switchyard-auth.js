// Switchyard browser-based login for TeamClaude.
//
// Mirrors the flow used by switchyard-mcp: device-code flow first, with a
// loopback-redirect fallback for older/self-hosted servers. The resulting
// multi-workspace bearer token is written into TeamClaude's config so the
// usage pusher can authenticate to Switchyard.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

const DEFAULT_BASE_URL = 'https://switchyard.work';

/**
 * Obtain a Switchyard API token via browser authorization.
 *
 * @param {string} [baseUrl] - Switchyard instance. Defaults to https://switchyard.work.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchFn] - test seam
 * @param {function} [options.openBrowser] - test seam
 * @param {function} [options.log] - stderr-ish logger
 * @returns {Promise<{ baseUrl: string, token: string, workspaces: { slug: string, name?: string }[] }>}
 */
export async function authorizeSwitchyard(baseUrl = DEFAULT_BASE_URL, options = {}) {
  baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetchFn = options.fetchFn || globalThis.fetch;
  const log = options.log || ((...a) => process.stderr.write(a.join(' ') + '\n'));
  const opener = options.openBrowser || openBrowser;
  const loopbackTimeoutMs = options.loopbackTimeoutMs || 10 * 60 * 1000;

  try {
    const result = await deviceCodeFlow(baseUrl, { fetchFn, log, opener });
    return { baseUrl, ...result };
  } catch (err) {
    if (err.code === 'DEVICE_FLOW_UNSUPPORTED') {
      log(`(device authorization unavailable — falling back to same-machine browser flow)`);
      const result = await loopbackFlow(baseUrl, { fetchFn, log, opener, timeoutMs: loopbackTimeoutMs });
      return { baseUrl, ...result };
    }
    throw err;
  }
}

async function deviceCodeFlow(baseUrl, { fetchFn, log, opener }) {
  const startUrl = `${baseUrl}/dashboard/cli-auth/start`;
  const res = await fetchFn(startUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const body = await res.text();

  if (res.status === 404 || res.status === 405) {
    const err = new Error('server does not support device authorization');
    err.code = 'DEVICE_FLOW_UNSUPPORTED';
    throw err;
  }
  if (!res.ok) {
    throw new Error(`start authorization (${res.status}): ${body.slice(0, 200)}`);
  }

  let start;
  try {
    start = JSON.parse(body);
  } catch {
    throw new Error('malformed start-authorization response');
  }
  if (!start.device_code || !start.request_id) {
    throw new Error('start-authorization response missing device_code or request_id');
  }

  const verificationURL = start.request_id
    ? `${baseUrl}/dashboard/cli-auth?request=${encodeURIComponent(start.request_id)}`
    : start.verification_url;

  log('To authorize TeamClaude, open this URL in a browser — any device works:');
  log('');
  log('  ', verificationURL);
  log('');

  await opener(verificationURL).catch(() => {
    log(`(no browser could be auto-opened here — copy the URL into a browser on any device.)`);
  });
  log('Waiting for authorization... (this terminal polls the server)');

  const pollUrl = `${baseUrl}/dashboard/cli-auth/poll`;
  const intervalMs = Math.max(3000, Math.min((start.poll_interval_seconds || 3) * 1000, 3600000));
  const ttlMs = Math.min((start.expires_in_seconds || 900) * 1000, 3600000);
  const deadline = Date.now() + ttlMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const reqTimeout = Math.max(5000, Math.min(remaining, 30000));

    let pollRes;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), reqTimeout);
      pollRes = await fetchFn(pollUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ device_code: start.device_code }).toString(),
        signal: controller.signal,
      });
      clearTimeout(t);
    } catch {
      // transient network blip — keep polling
    }

    if (pollRes?.ok) {
      let out;
      try {
        out = await pollRes.json();
      } catch {
        out = {};
      }
      if (out.status === 'approved') {
        if (!out.tokens?.length) throw new Error('authorization approved but no token was delivered');
        return collapseTokens(out.tokens);
      }
      if (out.status === 'denied') throw new Error('authorization was cancelled in the browser');
      if (out.status === 'expired') throw new Error('authorization request expired');
    }

    const wait = Math.min(intervalMs, deadline - Date.now());
    if (wait > 0) await sleep(wait);
  }

  throw new Error('timed out waiting for browser authorization');
}

async function loopbackFlow(baseUrl, { log, opener, timeoutMs = 10 * 60 * 1000 }) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const state = randomBytes(32).toString('base64url');
  const callbackURL = `http://127.0.0.1:${port}/cb`;
  const authURL = `${baseUrl}/dashboard/cli-auth?cb=${encodeURIComponent(callbackURL)}&state=${encodeURIComponent(state)}`;

  log('Opening browser to authorize TeamClaude...');
  log('');
  log('  ', authURL);
  log('');
  log('If your browser did not open, copy that URL in manually.');
  log('Waiting for authorization...');

  await opener(authURL).catch(e => {
    log(`(could not auto-open browser: ${e.message})`);
  });

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      server.close();
      reject(new Error('timed out waiting for browser authorization'));
    }, timeoutMs);

    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/cb') {
        res.writeHead(404).end('not found');
        return;
      }

      const gotState = url.searchParams.get('state');
      const gotError = url.searchParams.get('error');

      res.setHeader('content-type', 'text/html; charset=utf-8');

      if (gotError) {
        res.writeHead(200).end('<h1>Cancelled</h1><p>You can close this window.</p>');
        clearTimeout(timeout);
        server.close();
        reject(new Error(`user cancelled: ${gotError}`));
        return;
      }

      if (gotState !== state) {
        res.writeHead(200).end('<h1>State mismatch</h1><p>Possible CSRF, aborting.</p>');
        clearTimeout(timeout);
        server.close();
        reject(new Error('state mismatch — possible CSRF'));
        return;
      }

      const tokens = parseCallbackTokens(url.searchParams);
      if (!tokens.length) {
        res.writeHead(200).end('<h1>No token in callback</h1>');
        clearTimeout(timeout);
        server.close();
        reject(new Error('no token in callback'));
        return;
      }

      const { token, workspaces } = collapseTokens(tokens);
      const names = workspaces.map(w => w.name || w.slug).join(', ');
      res.writeHead(200).end(`<!doctype html><html><body><h1>✓ Authorized</h1><p>TeamClaude now has a token for <strong>${escapeHtml(names || 'Switchyard')}</strong>. You can close this window.</p></body></html>`);
      clearTimeout(timeout);
      server.close();
      resolve({ token, workspaces });
    });
  });

  return result;
}

function parseCallbackTokens(params) {
  const raw = params.get('tokens');
  if (raw) {
    const tokens = JSON.parse(raw);
    if (!Array.isArray(tokens) || tokens.length === 0) throw new Error('tokens callback param is empty');
    return tokens;
  }
  const tok = params.get('token');
  if (tok) return [{ token: tok }];
  return [];
}

function collapseTokens(tokens) {
  let token = '';
  const workspaces = [];
  for (const t of tokens) {
    if (!token && t.token) token = t.token;
    if (t.slug) workspaces.push({ slug: t.slug, name: t.name || undefined });
  }
  return { token, workspaces };
}

export function openBrowser(target) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd, args;
    if (platform === 'darwin') { cmd = 'open'; args = [target]; }
    else if (platform === 'linux') { cmd = 'xdg-open'; args = [target]; }
    else if (platform === 'win32') { cmd = 'rundll32'; args = ['url.dll,FileProtocolHandler', target]; }
    else { reject(new Error(`unsupported OS ${platform}`)); return; }

    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Try to import an existing token from switchyard-mcp's tokens.json.
 * Returns null if not found or unreadable.
 */
export async function importSwitchyardMcpToken() {
  try {
    const configDir = process.env.SWITCHYARD_CONFIG_HOME || join(homedir(), 'Library/Application Support/switchyard');
    const data = JSON.parse(await readFile(join(configDir, 'tokens.json'), 'utf-8'));
    if (data.token && data.base_url) {
      return { baseUrl: data.base_url, token: data.token, workspaces: data.workspaces || [] };
    }
  } catch {
    // ignore — no existing token or unreadable
  }
  return null;
}
