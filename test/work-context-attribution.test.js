import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';
import { WorkContextStore } from '../src/work-context.js';

// End to end: a session that claimed a work item has its response tokens booked
// into the work-context ledger, labelled with the claim and the serving account,
// while the per-model counters see every request.

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function usageUpstream() {
  return http.createServer((req, res) => {
    if (req.url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100}}}\n\n');
      res.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":40}}\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, usage: { input_tokens: 7, output_tokens: 3 } }));
  });
}

async function post(port, sessionId, path = '/v1/messages') {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sessionId ? { 'x-claude-code-session-id': sessionId } : {}) },
    body: JSON.stringify({ model: 'claude-opus-5', messages: [] }),
  });
  await res.text();
  return res.status;
}

test('a claimed session books its tokens into the work-context ledger', async () => {
  const upstream = usageUpstream();
  const upstreamPort = await listen(upstream);
  const am = new AccountManager([{ name: 'acct', type: 'api_key', apiKey: 'sk-a' }], 0.98);
  const store = new WorkContextStore();
  store.claim('s1', { project_slug: 'acme', bead_id: 'bead-1', prd_id: 7 });
  const proxy = createProxyServer(am, { proxy: {}, upstream: `http://127.0.0.1:${upstreamPort}` }, { workContextStore: store });
  const proxyPort = await listen(proxy);

  try {
    assert.equal(await post(proxyPort, 's1'), 200);             // JSON body
    assert.equal(await post(proxyPort, 's1', '/stream'), 200);  // SSE
    assert.equal(await post(proxyPort, 's2'), 200);             // no claim
    assert.equal(await post(proxyPort, null), 200);             // no session

    const events = store.ledger;
    // One event per request: the stream's two usage reports are one request.
    assert.equal(events.length, 2);
    assert.ok(events.every(e => e.sessionId === 's1'), 'only the claimed session is booked');
    const summary = store.usageSummary({ groupBy: 'projectSlug' });
    assert.equal(summary.totalRequests, 2);
    assert.equal(events.reduce((n, e) => n + e.inputTokens, 0), 107);
    assert.equal(events.reduce((n, e) => n + e.outputTokens, 0), 43);
    for (const e of events) {
      assert.equal(e.accountName, 'acct');
      assert.equal(e.accountIndex, 0);
      assert.equal(e.model, 'claude-opus-5');
      assert.equal(e.projectSlug, 'acme');
      assert.equal(e.beadId, 'bead-1');
      assert.equal(e.prdId, 7);
    }

    // Per-model counts every message once, claimed or not.
    const row = am.accounts[0].usage.byModel['claude-opus-5'];
    assert.equal(row.requests, 4);
    assert.equal(row.inputTokens, 7 + 100 + 7 + 7);
    assert.equal(row.outputTokens, 3 + 40 + 3 + 3);
  } finally {
    proxy.close();
    upstream.close();
  }
});

test('a released claim stops attribution from the next request', async () => {
  const upstream = usageUpstream();
  const upstreamPort = await listen(upstream);
  const am = new AccountManager([{ name: 'acct', type: 'api_key', apiKey: 'sk-a' }], 0.98);
  const store = new WorkContextStore();
  store.claim('s1', { project_slug: 'acme' });
  const proxy = createProxyServer(am, { proxy: {}, upstream: `http://127.0.0.1:${upstreamPort}` }, { workContextStore: store });
  const proxyPort = await listen(proxy);

  try {
    await post(proxyPort, 's1');
    store.release('s1');
    await post(proxyPort, 's1');
    assert.equal(store.ledger.length, 1);
  } finally {
    proxy.close();
    upstream.close();
  }
});
