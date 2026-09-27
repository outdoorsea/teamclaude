import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountManager } from '../src/account-manager.js';
import { createProxyServer } from '../src/server.js';

// The root and the retired /dashboard route both land on the one dashboard.

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const ACCTS = [{ name: 'alice@example.com', type: 'apikey', apiKey: 'k1' }];
const NO_UPSTREAM = { proxy: {}, upstream: 'http://127.0.0.1:1' };

test('/ and /dashboard redirect to /teamclaude/dashboard', async (t) => {
  const server = createProxyServer(new AccountManager(ACCTS), NO_UPSTREAM);
  const port = await listen(server);
  t.after(() => server.close());

  for (const path of ['/', '/dashboard', '/dashboard/', '/dashboard/anything']) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get('location'), '/teamclaude/dashboard', path);
  }

  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
});
