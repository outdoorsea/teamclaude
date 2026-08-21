import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkContextStore } from '../src/work-context.js';

describe('WorkContextStore', () => {
  it('stores and retrieves context', () => {
    const store = new WorkContextStore();
    const ctx = store.setContext('sess-1', { projectSlug: 'acme', prdId: 7 });
    assert.equal(ctx.projectSlug, 'acme');
    assert.equal(ctx.prdId, 7);
    assert.equal(store.get('sess-1').projectSlug, 'acme');
  });

  it('claim marks context active and release marks inactive', () => {
    const store = new WorkContextStore();
    store.claim('sess-1', { beadId: 'bead-a' });
    assert.equal(store.activeContexts().length, 1);
    store.release('sess-1');
    assert.equal(store.activeContexts().length, 0);
    assert.equal(store.get('sess-1').active, false);
  });

  it('usageSummary aggregates by project', () => {
    const store = new WorkContextStore();
    store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, model: 'claude-3', inputTokens: 10, outputTokens: 5, projectSlug: 'acme', beadId: 'b1' });
    store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, model: 'claude-3', inputTokens: 20, outputTokens: 10, projectSlug: 'acme', beadId: 'b2' });
    store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, model: 'claude-3', inputTokens: 7, outputTokens: 3, projectSlug: 'other', beadId: 'b3' });
    const summary = store.usageSummary({ groupBy: 'projectSlug', hours: 24 });
    assert.equal(summary.buckets.length, 2);
    const acme = summary.buckets.find(b => b.key === 'acme');
    assert.equal(acme.inputTokens, 30);
    assert.equal(acme.outputTokens, 15);
    assert.equal(acme.requests, 2);
  });

  it('usageSummary filters by prd_id', () => {
    const store = new WorkContextStore();
    store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, inputTokens: 10, outputTokens: 5, projectSlug: 'acme', prdId: 1 });
    store.recordUsage({ timestamp: Date.now(), accountName: 'a', accountIndex: 0, inputTokens: 20, outputTokens: 10, projectSlug: 'acme', prdId: 2 });
    const summary = store.usageSummary({ groupBy: 'projectSlug', hours: 24, filters: { prdId: 1 } });
    assert.equal(summary.totalInputTokens, 10);
  });

  it('recordUsage appends newline-delimited JSON to usageLogPath', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tc-usage-'));
    const logPath = join(dir, 'usage.log');
    try {
      const store = new WorkContextStore({ usageLogPath: logPath });
      const event = { timestamp: 1234567890, accountName: 'a', accountIndex: 0, inputTokens: 10, outputTokens: 5, projectSlug: 'acme' };
      store.recordUsage(event);
      // Wait for the fire-and-forget append.
      await new Promise(r => setTimeout(r, 50));
      const raw = await readFile(logPath, 'utf-8');
      const lines = raw.trim().split('\n');
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.projectSlug, 'acme');
      assert.equal(parsed.inputTokens, 10);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
