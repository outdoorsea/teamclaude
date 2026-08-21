// In-memory store that maps Claude Code session ids to the project / PRD / PR /
// bead context an agent declares through the MCP server. Context is used by the
// proxy to attribute API token usage to Switchyard work items.

import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_MAX_CONTEXT_AGE_MS = 60 * 60 * 1000; // 1h
export const USAGE_LEDGER_MAX_EVENTS = 100_000;

export class WorkContextStore {
  constructor({ maxAgeMs = DEFAULT_MAX_CONTEXT_AGE_MS, maxLedgerEvents = USAGE_LEDGER_MAX_EVENTS, usageLogPath = null, now = () => Date.now() } = {}) {
    // sessionId -> WorkContext
    this.contexts = new Map();
    this.maxAgeMs = maxAgeMs;
    this.maxLedgerEvents = maxLedgerEvents;
    this.usageLogPath = usageLogPath;
    this._now = now;
    // rolling usage events
    this.ledger = [];
  }

  setContext(sessionId, fields) {
    if (!sessionId) return null;
    const now = new Date().toISOString();
    const existing = this.contexts.get(sessionId);
    const ctx = {
      sessionId,
      tenantSlug: fields.tenantSlug ?? fields.tenant_slug ?? existing?.tenantSlug ?? null,
      projectSlug: fields.projectSlug ?? fields.project_slug ?? existing?.projectSlug ?? null,
      projectId: fields.projectId ?? fields.project_id ?? existing?.projectId ?? null,
      prdId: fields.prdId ?? fields.prd_id ?? existing?.prdId ?? null,
      prNumber: fields.prNumber ?? fields.pr_number ?? existing?.prNumber ?? null,
      beadId: fields.beadId ?? fields.bead_id ?? existing?.beadId ?? null,
      agentRef: fields.agentRef ?? fields.agent_ref ?? existing?.agentRef ?? null,
      rigName: fields.rigName ?? fields.rig_name ?? existing?.rigName ?? null,
      claimedAt: existing?.claimedAt ?? now,
      updatedAt: now,
      releasedAt: null,
      active: true,
    };
    this.contexts.set(sessionId, ctx);
    this._sweep();
    return ctx;
  }

  claim(sessionId, fields) {
    if (!sessionId) return null;
    const now = new Date().toISOString();
    const existing = this.contexts.get(sessionId);
    const ctx = {
      sessionId,
      tenantSlug: fields.tenantSlug ?? fields.tenant_slug ?? existing?.tenantSlug ?? null,
      projectSlug: fields.projectSlug ?? fields.project_slug ?? existing?.projectSlug ?? null,
      projectId: fields.projectId ?? fields.project_id ?? existing?.projectId ?? null,
      prdId: fields.prdId ?? fields.prd_id ?? existing?.prdId ?? null,
      prNumber: fields.prNumber ?? fields.pr_number ?? existing?.prNumber ?? null,
      beadId: fields.beadId ?? fields.bead_id ?? existing?.beadId ?? null,
      agentRef: fields.agentRef ?? fields.agent_ref ?? existing?.agentRef ?? null,
      rigName: fields.rigName ?? fields.rig_name ?? existing?.rigName ?? null,
      claimedAt: now,
      updatedAt: now,
      releasedAt: null,
      active: true,
    };
    this.contexts.set(sessionId, ctx);
    this._sweep();
    return ctx;
  }

  release(sessionId) {
    const ctx = this.contexts.get(sessionId);
    if (!ctx) return null;
    ctx.active = false;
    ctx.releasedAt = new Date().toISOString();
    ctx.updatedAt = ctx.releasedAt;
    return ctx;
  }

  get(sessionId) {
    this._sweep();
    return this.contexts.get(sessionId) || null;
  }

  activeContexts() {
    this._sweep();
    return [...this.contexts.values()].filter(c => c.active);
  }

  allContexts() {
    this._sweep();
    return [...this.contexts.values()];
  }

  recordUsage(event) {
    this.ledger.push(event);
    if (this.ledger.length > this.maxLedgerEvents) {
      this.ledger = this.ledger.slice(-this.maxLedgerEvents);
    }
    if (this.usageLogPath) {
      // Fire-and-forget: the proxy must never stall on disk I/O.
      this._appendUsage(event).catch(() => {});
    }
  }

  async _appendUsage(event) {
    await mkdir(dirname(this.usageLogPath), { recursive: true });
    await appendFile(this.usageLogPath, JSON.stringify(event) + '\n');
    // Restrict the log to owner-only; it contains session/account context.
    await chmod(this.usageLogPath, 0o600).catch(() => {});
  }

  usageSummary({ groupBy = 'projectSlug', hours = 24, filters = {} } = {}) {
    const cutoff = this._now() - hours * 60 * 60 * 1000;
    const buckets = new Map();
    let totalInput = 0;
    let totalOutput = 0;
    let totalRequests = 0;

    for (const e of this.ledger) {
      if (e.timestamp < cutoff) continue;
      if (filters.projectSlug && e.projectSlug !== filters.projectSlug) continue;
      if (filters.prdId != null && e.prdId !== filters.prdId) continue;
      if (filters.beadId && e.beadId !== filters.beadId) continue;

      const key = groupBy === 'account' ? e.accountName
        : groupBy === 'session' ? e.sessionId
        : e[groupBy] ?? '(unset)';

      const b = buckets.get(key) || { key, inputTokens: 0, outputTokens: 0, requests: 0 };
      b.inputTokens += e.inputTokens || 0;
      b.outputTokens += e.outputTokens || 0;
      b.requests += 1;
      buckets.set(key, b);

      totalInput += e.inputTokens || 0;
      totalOutput += e.outputTokens || 0;
      totalRequests += 1;
    }

    return {
      groupBy,
      hours,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalRequests,
      buckets: [...buckets.values()].sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)),
    };
  }

  _sweep() {
    const cutoff = this._now() - this.maxAgeMs;
    for (const [id, ctx] of this.contexts) {
      if (!ctx.active && new Date(ctx.updatedAt).getTime() < cutoff) {
        this.contexts.delete(id);
      }
    }
  }
}
