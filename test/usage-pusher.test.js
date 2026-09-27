import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UsagePusher, eventToRow } from '../src/usage-pusher.js';

describe('UsagePusher', () => {
  it('eventToRow maps usage event to Switchyard row', () => {
    const row = eventToRow({
      sessionId: 'sess-1',
      beadId: 'bead-a',
      agentRef: 'builder',
      model: 'claude-3-5-sonnet',
      inputTokens: 10,
      outputTokens: 5,
    }, 'push');
    assert.equal(row.bead_id, 'bead-a');
    assert.equal(row.session_name, 'sess-1');
    assert.equal(row.agent_ref, 'builder');
    assert.equal(row.model, 'claude-3-5-sonnet');
    assert.equal(row.input, 10);
    assert.equal(row.output, 5);
    assert.equal(row.cache_creation, 0);
    assert.equal(row.cache_read, 0);
    assert.equal(row.source, 'push');
  });

  it('pushAll batches rows by tenant/project and advances cursor on success', async () => {
    const posts = [];
    const fetchFn = async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ recorded: 1, errors: 0 }) };
    };

    const store = {
      ledger: [
        { timestamp: Date.now() - 100, tenantSlug: 'acme', projectSlug: 'web', beadId: 'b1', sessionId: 's1', inputTokens: 10, outputTokens: 5 },
        { timestamp: Date.now() - 50, tenantSlug: 'acme', projectSlug: 'api', beadId: 'b2', sessionId: 's2', inputTokens: 20, outputTokens: 10 },
      ],
    };

    const pusher = new UsagePusher(store, {
      baseUrl: 'https://switchyard.work',
      intervalMs: 60_000,
      apiKey: 'sy-test',
      fetchFn,
    });

    await pusher.pushAll();

    assert.equal(posts.length, 2);
    assert.ok(posts.some(p => p.url === 'https://switchyard.work/api/v1/projects/acme/web/token-usage'));
    assert.ok(posts.some(p => p.url === 'https://switchyard.work/api/v1/projects/acme/api/token-usage'));
    assert.equal(posts[0].body.rows.length, 1);
    assert.equal(pusher.lastPushAt, pusher.lastRunStartedAt);
  });

  it('pushAll skips events without tenant or project', async () => {
    const posts = [];
    const fetchFn = async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ recorded: 1, errors: 0 }) };
    };

    const store = {
      ledger: [
        { timestamp: Date.now() - 100, tenantSlug: 'acme', projectSlug: 'web', beadId: 'b1', sessionId: 's1', inputTokens: 10, outputTokens: 5 },
        { timestamp: Date.now() - 50, inputTokens: 20, outputTokens: 10 },
      ],
    };

    const pusher = new UsagePusher(store, { baseUrl: 'https://switchyard.work', intervalMs: 60_000, fetchFn });
    await pusher.pushAll();

    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.rows.length, 1);
  });

  it('pushAll does not advance cursor on HTTP error', async () => {
    const store = {
      ledger: [{ timestamp: Date.now() - 100, tenantSlug: 'acme', projectSlug: 'web', beadId: 'b1', sessionId: 's1', inputTokens: 10, outputTokens: 5 }],
    };

    const pusher = new UsagePusher(store, {
      baseUrl: 'https://switchyard.work',
      intervalMs: 60_000,
      fetchFn: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
    });

    const before = pusher.lastPushAt;
    await pusher.pushAll();

    assert.equal(pusher.lastPushAt, before);
    assert.ok(pusher.lastError);
  });

  it('splits large batches into 500-row chunks', async () => {
    const posts = [];
    const fetchFn = async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ recorded: 500, errors: 0 }) };
    };

    const ledger = [];
    for (let i = 0; i < 1200; i++) {
      ledger.push({ timestamp: Date.now() - 100, tenantSlug: 'acme', projectSlug: 'web', beadId: `b${i}`, sessionId: `s${i}`, inputTokens: 1, outputTokens: 0 });
    }

    const pusher = new UsagePusher({ ledger }, { baseUrl: 'https://switchyard.work', intervalMs: 60_000, fetchFn });
    await pusher.pushAll();

    assert.equal(posts.length, 3);
    assert.equal(posts[0].body.rows.length, 500);
    assert.equal(posts[1].body.rows.length, 500);
    assert.equal(posts[2].body.rows.length, 200);
  });
});
