// Opt-in Switchyard usage push.
//
// DISABLED BY DEFAULT. When enabled (config.switchyard.baseUrl + apiKey),
// periodically POSTs token usage rows to Switchyard's batch endpoint:
//
//   POST /api/v1/projects/{tenant}/{project}/token-usage
//
// Each row is attributed to a bead/session/agent so Switchyard can reconcile
// Claude API spend with the work item that caused it.

export class UsagePusher {
  constructor(workContextStore, {
    baseUrl = null,
    intervalMs = 0,
    apiKey = null,
    timeoutMs = 30_000,
    log = console.log,
    fetchFn = globalThis.fetch,
    source = 'push',
  } = {}) {
    this.store = workContextStore;
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.intervalMs = intervalMs;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.fetchFn = fetchFn;
    this.source = source;
    this.timer = null;
    this._running = false;
    this.lastRunStartedAt = null;
    this.lastRunFinishedAt = null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.nextRunAt = baseUrl && intervalMs > 0 ? Date.now() + intervalMs : null;
    // On startup, push events from the last interval to avoid a huge backlog.
    this.lastPushAt = baseUrl && intervalMs > 0 ? Date.now() - intervalMs : Date.now();
  }

  start() {
    if (this.baseUrl && this.intervalMs > 0) this.reschedule();
  }

  /** Change URL/key/interval at runtime (interval 0 = off). Pushes once immediately when turned on. */
  reschedule({ baseUrl = this.baseUrl, intervalMs = this.intervalMs, apiKey = this.apiKey } = {}) {
    const wasOn = this.intervalMs > 0 && this.baseUrl;
    const turningOn = intervalMs > 0 && baseUrl;
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : null;
    this.apiKey = apiKey;
    this.intervalMs = intervalMs;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    if (turningOn) {
      this.nextRunAt = Date.now() + intervalMs;
      if (!wasOn) this.pushAll().catch(() => {});
      this.timer = setInterval(() => this.pushAll().catch(() => {}), intervalMs);
      this.timer.unref?.();
      this.log(`[TeamClaude] Switchyard usage push enabled → ${this.baseUrl} (every ${Math.round(intervalMs / 1000)}s)`);
    } else if (wasOn) {
      this.nextRunAt = null;
      this.log('[TeamClaude] Switchyard usage push disabled');
    }
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.nextRunAt = null;
  }

  /** Push one batch of usage events. Overlapping cycles are skipped. */
  async pushAll() {
    if (!this.baseUrl || this._running) return;
    this._running = true;
    this.lastRunStartedAt = Date.now();
    this.nextRunAt = this.intervalMs > 0 ? this.lastRunStartedAt + this.intervalMs : null;
    this.lastError = null;
    try {
      const now = Date.now();
      const events = this.store.ledger.filter(e => e.timestamp > this.lastPushAt && e.timestamp <= now);
      if (events.length === 0) {
        this.lastPushAt = now;
        return;
      }

      await this._pushEvents(events);
      this.lastSuccessAt = now;
      this.lastPushAt = now;
    } catch (err) {
      this.lastError = err?.message || String(err);
      this.log(`[TeamClaude] Usage push failed: ${this.lastError}`);
    } finally {
      this.lastRunFinishedAt = Date.now();
      this._running = false;
    }
  }

  getStatus() {
    return {
      enabled: Boolean(this.baseUrl && this.intervalMs > 0),
      baseUrl: this.baseUrl,
      intervalSeconds: Math.round(this.intervalMs / 1000),
      running: this._running,
      lastRunStartedAt: iso(this.lastRunStartedAt),
      lastRunFinishedAt: iso(this.lastRunFinishedAt),
      lastSuccessAt: iso(this.lastSuccessAt),
      nextRunAt: iso(this.nextRunAt),
      lastError: this.lastError,
    };
  }

  async _pushEvents(events) {
    // Group by Switchyard project path. Events without tenant/project cannot be
    // attributed and are dropped (they stay in the disk log).
    const byProject = new Map();
    for (const e of events) {
      if (!e.tenantSlug || !e.projectSlug) continue;
      const key = `${e.tenantSlug}/${e.projectSlug}`;
      const rows = byProject.get(key) || [];
      rows.push(eventToRow(e, this.source));
      byProject.set(key, rows);
    }

    for (const [key, rows] of byProject) {
      const url = `${this.baseUrl}/api/v1/projects/${key}/token-usage`;
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        await this._postBatch(url, batch);
      }
    }
  }

  async _postBatch(url, rows) {
    const headers = {
      'content-type': 'application/json',
      'user-agent': 'teamclaude-usage-pusher/1.0',
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this._withTimeout(this.fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows }),
    }));

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }

    // Switchyard returns { recorded, errors, first_error }. Log non-fatal errors.
    const json = await res.json().catch(() => ({}));
    if (json.errors) {
      this.log(`[TeamClaude] Usage push accepted ${json.recorded || 0} rows, ${json.errors} errors${json.first_error ? ': ' + json.first_error : ''}`);
    }
  }

  _withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('push timed out')), this.timeoutMs);
        t.unref?.();
      }),
    ]);
  }
}

export function eventToRow(event, source) {
  return {
    bead_id: event.beadId || null,
    session_name: event.sessionId || null,
    agent_ref: event.agentRef || null,
    model: event.model || null,
    input: event.inputTokens || 0,
    cache_creation: 0,
    cache_read: 0,
    output: event.outputTokens || 0,
    source,
  };
}

function iso(ts) {
  return ts ? new Date(ts).toISOString() : null;
}
