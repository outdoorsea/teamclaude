import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';
import { WorkContextStore } from '../src/work-context.js';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const CONFIG = { proxy: { apiKey: 'tc-test' }, upstream: 'https://api.anthropic.com' };
const ACCT = [{ name: 'a', type: 'apikey', apiKey: 'k' }];

function makeServer() {
  const am = new AccountManager(ACCT, 0.98);
  const store = new WorkContextStore();
  const proxy = createProxyServer(am, CONFIG, { workContextStore: store });
  return { proxy, store };
}

test('POST /teamclaude/context sets context', async () => {
  const { proxy, store } = makeServer();
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/teamclaude/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', project_slug: 'acme', prd_id: 7 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.context.projectSlug, 'acme');
    assert.equal(store.get('s1').projectSlug, 'acme');
  } finally {
    proxy.close();
  }
});

test('POST /teamclaude/context action=claim creates an active context', async () => {
  const { proxy, store } = makeServer();
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/teamclaude/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', action: 'claim', bead_id: 'bead-1', project_slug: 'acme' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.context.active, true);
    assert.equal(store.activeContexts().length, 1);
  } finally {
    proxy.close();
  }
});

test('POST /teamclaude/context action=release deactivates context', async () => {
  const { proxy, store } = makeServer();
  store.claim('s1', { bead_id: 'bead-1' });
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/teamclaude/context`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: 's1', action: 'release' }),
    });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.context.active, false);
  } finally {
    proxy.close();
  }
});

test('GET /teamclaude/contexts lists active contexts', async () => {
  const { proxy, store } = makeServer();
  store.claim('s1', { bead_id: 'bead-1', project_slug: 'acme' });
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/teamclaude/contexts`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.contexts.length, 1);
    assert.equal(body.contexts[0].beadId, 'bead-1');
  } finally {
    proxy.close();
  }
});

test('GET /teamclaude/usage returns aggregated usage', async () => {
  const { proxy, store } = makeServer();
  store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, inputTokens: 10, outputTokens: 5, projectSlug: 'acme' });
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/teamclaude/usage`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.totalInputTokens, 10);
    assert.equal(body.buckets.length, 1);
  } finally {
    proxy.close();
  }
});
