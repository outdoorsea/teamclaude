import { describe, it } from 'node:test';
import assert from 'node:assert';
import { authorizeSwitchyard } from '../src/switchyard-auth.js';

describe('authorizeSwitchyard', () => {
  it('device-code flow returns token and workspaces', async () => {
    let startCalled = false;
    let pollCount = 0;

    const fetchFn = async (url, init) => {
      if (url.endsWith('/dashboard/cli-auth/start')) {
        startCalled = true;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            request_id: 'req-1',
            device_code: 'dev-1',
            verification_url: 'https://switchyard.work/dashboard/cli-auth?request=req-1',
            poll_interval_seconds: 1,
            expires_in_seconds: 60,
          }),
        };
      }
      if (url.endsWith('/dashboard/cli-auth/poll')) {
        pollCount++;
        const body = new URLSearchParams(init.body);
        assert.equal(body.get('device_code'), 'dev-1');
        if (pollCount < 2) {
          return { ok: true, status: 200, json: async () => ({ status: 'pending' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'approved',
            tokens: [
              { slug: 'acme', name: 'Acme Corp', token: 'sy-test-token' },
            ],
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await authorizeSwitchyard('https://switchyard.work', { fetchFn, openBrowser: () => Promise.resolve(), log: () => {} });

    assert.equal(startCalled, true);
    assert.equal(pollCount, 2);
    assert.equal(result.token, 'sy-test-token');
    assert.equal(result.workspaces.length, 1);
    assert.equal(result.workspaces[0].slug, 'acme');
  });

  it('falls back to loopback flow when device flow is unsupported', async () => {
    const fetchFn = async (url) => {
      if (url.endsWith('/dashboard/cli-auth/start')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    // We can't easily test the real loopback browser callback here, so verify
    // it fails with a timeout when no browser arrives.
    await assert.rejects(
      authorizeSwitchyard('https://old.switchyard', {
        fetchFn,
        openBrowser: () => Promise.resolve(),
        log: () => {},
        loopbackTimeoutMs: 100,
      }),
      /timed out/
    );
  });

  it('throws on denied authorization', async () => {
    const fetchFn = async (url) => {
      if (url.endsWith('/dashboard/cli-auth/start')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            request_id: 'req-1',
            device_code: 'dev-1',
            verification_url: 'https://switchyard.work/dashboard/cli-auth?request=req-1',
            poll_interval_seconds: 1,
            expires_in_seconds: 60,
          }),
        };
      }
      if (url.endsWith('/dashboard/cli-auth/poll')) {
        return { ok: true, status: 200, json: async () => ({ status: 'denied' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    await assert.rejects(
      authorizeSwitchyard('https://switchyard.work', { fetchFn, openBrowser: () => Promise.resolve(), log: () => {} }),
      /cancelled/
    );
  });

  it('throws on expired authorization', async () => {
    const fetchFn = async (url) => {
      if (url.endsWith('/dashboard/cli-auth/start')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            request_id: 'req-1',
            device_code: 'dev-1',
            verification_url: 'https://switchyard.work/dashboard/cli-auth?request=req-1',
            poll_interval_seconds: 1,
            expires_in_seconds: 60,
          }),
        };
      }
      if (url.endsWith('/dashboard/cli-auth/poll')) {
        return { ok: true, status: 200, json: async () => ({ status: 'expired' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    await assert.rejects(
      authorizeSwitchyard('https://switchyard.work', { fetchFn, openBrowser: () => Promise.resolve(), log: () => {} }),
      /expired/
    );
  });
});
