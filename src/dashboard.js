import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function serveDashboard(req, res) {
  const url = req.url || '/';
  if (url === '/dashboard') {
    res.writeHead(302, { Location: '/dashboard/' });
    res.end();
    return;
  }
  if (url === '/dashboard/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DASHBOARD_HTML);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TeamClaude Dashboard</title>
<style>
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #1c2128;
  --border: #30363d;
  --text: #c9d1d9;
  --muted: #8b949e;
  --accent: #58a6ff;
  --green: #3fb950;
  --yellow: #d29922;
  --red: #f85149;
  --orange: #db6d28;
  --radius: 10px;
  --shadow: 0 4px 24px rgba(0,0,0,0.35);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(13,17,23,0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
header h1 {
  margin: 0;
  font-size: 1.3rem;
  display: flex;
  align-items: center;
  gap: 10px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
}
.dot.offline { background: var(--red); box-shadow: 0 0 8px var(--red); }
.actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
button {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s, border-color 0.15s;
}
button:hover:not(:disabled) { background: #21262d; border-color: var(--muted); }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.primary:hover:not(:disabled) { background: #79b8ff; border-color: #79b8ff; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.small { font-size: 0.8rem; color: var(--muted); }
main { padding: 24px; max-width: 1200px; margin: 0 auto; }
.error-banner {
  background: rgba(248,81,73,0.12);
  border: 1px solid var(--red);
  color: #ffdcd7;
  padding: 12px 16px;
  border-radius: var(--radius);
  margin-bottom: 20px;
  display: none;
}
.error-banner.visible { display: block; }
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
.summary-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
}
.summary-card .label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.summary-card .value { font-size: 1.4rem; font-weight: 600; margin-top: 4px; }
.accounts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 20px;
}
.account-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  box-shadow: var(--shadow);
  transition: border-color 0.2s;
}
.account-card.current { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }
.account-card.disabled-card { opacity: 0.72; }
.account-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.account-title { display: flex; align-items: center; gap: 10px; }
.account-name { font-size: 1.15rem; font-weight: 600; }
.badge {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--muted);
}
.badge.active { color: var(--green); border-color: var(--green); background: rgba(63,185,80,0.08); }
.badge.throttled { color: var(--yellow); border-color: var(--yellow); background: rgba(210,153,34,0.08); }
.badge.error { color: var(--red); border-color: var(--red); background: rgba(248,81,73,0.08); }
.badge.exhausted { color: var(--red); border-color: var(--red); background: rgba(248,81,73,0.08); }
.badge.disabled { color: var(--muted); border-color: var(--border); background: rgba(139,148,158,0.08); }
.meta { font-size: 0.85rem; color: var(--muted); margin-top: 4px; }
.quota { margin: 12px 0; }
.quota-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--muted);
  margin-bottom: 4px;
}
.quota-bar-bg {
  height: 8px;
  background: var(--panel-2);
  border-radius: 4px;
  overflow: hidden;
}
.quota-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background 0.3s ease;
}
.quota-bar-fill.low { background: var(--green); }
.quota-bar-fill.med { background: var(--yellow); }
.quota-bar-fill.high { background: var(--red); }
.usage { font-size: 0.85rem; color: var(--muted); margin-top: 10px; }
.account-actions { margin-top: 14px; display: flex; gap: 8px; }
.routes {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  margin-top: 24px;
  box-shadow: var(--shadow);
}
.routes h2 { margin: 0 0 12px; font-size: 1.05rem; }
.route-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.route-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px; border-bottom: 1px solid var(--border); }
.route-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.route-table tr:last-child td { border-bottom: none; }
.route-accounts { display: flex; gap: 6px; flex-wrap: wrap; }
.route-pill { font-size: 0.8rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
.route-pill.eligible { color: var(--green); border-color: var(--green); background: rgba(63,185,80,0.08); }
.route-pill.ineligible { color: var(--red); border-color: var(--red); background: rgba(248,81,73,0.08); }
.errors {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  margin-top: 24px;
  box-shadow: var(--shadow);
}
.errors h2 { margin: 0 0 8px; font-size: 1.05rem; }
.errors p { margin: 0 0 12px; }
.error-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.error-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px; border-bottom: 1px solid var(--border); }
.error-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.error-table tr:last-child td { border-bottom: none; }
.error-table td code { color: var(--red); font-size: 0.8rem; }
.contexts {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  margin-top: 24px;
  box-shadow: var(--shadow);
}
.contexts h2 { margin: 0 0 12px; font-size: 1.05rem; }
.context-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.context-table th { text-align: left; color: var(--muted); font-weight: 500; padding: 8px; border-bottom: 1px solid var(--border); }
.context-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); }
.context-table tr:last-child td { border-bottom: none; }
.empty { color: var(--muted); font-style: italic; padding: 20px; text-align: center; }
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 18px;
  border-radius: 8px;
  color: #fff;
  font-size: 0.9rem;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.3s, transform 0.3s;
  pointer-events: none;
  z-index: 100;
}
.toast.visible { opacity: 1; transform: translateY(0); }
.toast.success { background: var(--green); }
.toast.error { background: var(--red); }
</style>
</head>
<body>
<header>
  <h1><span class="dot" id="status-dot"></span> TeamClaude Dashboard</h1>
  <div class="actions">
    <span class="small" id="last-updated">Connecting…</span>
    <button id="reload-btn" onclick="reloadConfig()">Reload config</button>
    <button onclick="location.reload()">Refresh page</button>
  </div>
</header>
<main>
  <div class="error-banner" id="error-banner"></div>
  <section class="summary" id="summary"></section>
  <section class="accounts" id="accounts"></section>
  <section class="contexts" id="contexts" style="display:none">
    <h2>Active Work Contexts</h2>
    <table class="context-table"><thead><tr><th>Session</th><th>Project</th><th>PRD</th><th>Bead</th><th>Agent</th><th>Claimed</th></tr></thead><tbody id="contexts-body"></tbody></table>
  </section>
  <section class="routes" id="routes" style="display:none">
    <h2>Routing</h2>
    <table class="route-table"><thead><tr><th>Match</th><th>Accounts</th><th>Notes</th></tr></thead><tbody id="routes-body"></tbody></table>
  </section>
  <section class="errors" id="errors" style="display:none">
    <h2>Recent upstream errors</h2>
    <p class="small">Network/timeout failures reaching Anthropic. Empty when everything is healthy.</p>
    <table class="error-table"><thead><tr><th>Time</th><th>Account</th><th>Error</th><th>Type</th></tr></thead><tbody id="errors-body"></tbody></table>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>
const POLL_INTERVAL = 2000;
let pollTimer = null;

async function fetchStatus() {
  const res = await fetch('/teamclaude/status');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function setOnline(online) {
  document.getElementById('status-dot').classList.toggle('offline', !online);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (!msg) {
    el.classList.remove('visible');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.add('visible');
}

function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast visible ' + type;
  setTimeout(() => { el.classList.remove('visible'); }, 3000);
}

function formatDuration(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

function timeUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso).getTime() - Date.now();
  return d <= 0 ? 'now' : 'in ' + formatDuration(d);
}

function pct(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.min(100, Math.max(0, value * 100)).toFixed(1);
}

function quotaBar(label, value, resetIso) {
  const p = pct(value);
  if (p == null) return '';
  const cls = value < 0.7 ? 'low' : value < 0.9 ? 'med' : 'high';
  const reset = timeUntil(resetIso) || '';
  return \`
    <div class="quota">
      <div class="quota-label"><span>\${label}</span><span>\${p}%\${reset ? ' · resets ' + reset : ''}</span></div>
      <div class="quota-bar-bg"><div class="quota-bar-fill \${cls}" style="width:\${p}%"></div></div>
    </div>
  \`;
}

function renderSummary(data) {
  const sessions = data.sessions || {};
  const server = data.server || {};
  const uptime = server.uptimeSeconds != null ? formatDuration(server.uptimeSeconds * 1000) : '-';
  const html = \`
    <div class="summary-card"><div class="label">Current account</div><div class="value">\${escapeHtml(data.currentAccount || 'none')}</div></div>
    <div class="summary-card"><div class="label">Switch threshold</div><div class="value">\${((data.switchThreshold || 0) * 100).toFixed(0)}%</div></div>
    <div class="summary-card"><div class="label">Sessions</div><div class="value">\${sessions.active || 0} / \${sessions.known || 0}</div></div>
    <div class="summary-card"><div class="label">Uptime</div><div class="value">\${uptime}</div></div>
  \`;
  document.getElementById('summary').innerHTML = html;
}

function renderAccounts(data) {
  const container = document.getElementById('accounts');
  const accounts = data.accounts || [];
  if (!accounts.length) {
    container.innerHTML = '<div class="empty">No accounts configured.</div>';
    return;
  }
  const priorities = accounts.map(a => a.priority || 0);
  const minPrio = Math.min(...priorities);
  const maxPrio = Math.max(...priorities);
  container.innerHTML = accounts.map(acc => {
    const isCurrent = acc.name === data.currentAccount;
    const statusClass = acc.disabled ? 'disabled' : acc.status;
    const q = acc.quota || {};
    const bars = [
      quotaBar('Session (5h)', q.unified5h, q.unified5hReset),
      quotaBar('Weekly (7d)', q.unified7d, q.unified7dReset),
      q.unified7dSonnet != null ? quotaBar('Sonnet weekly', q.unified7dSonnet, q.unified7dSonnetReset) : '',
      q.unified7dFable != null ? quotaBar('Fable weekly', q.unified7dFable, q.unified7dFableReset) : '',
      (q.tokensLimit != null && q.tokensRemaining != null) ? quotaBar('Tokens', 1 - q.tokensRemaining / q.tokensLimit, q.resetsAt) : '',
      (q.requestsLimit != null && q.requestsRemaining != null) ? quotaBar('Requests', 1 - q.requestsRemaining / q.requestsLimit, q.resetsAt) : '',
    ].join('');
    const usage = acc.usage || {};
    const usageText = \`In: \${formatNumber(usage.totalInputTokens)} · Out: \${formatNumber(usage.totalOutputTokens)} · Requests: \${usage.totalRequests || 0}\`;
    const switchBtn = isCurrent
      ? '<button disabled>Active</button>'
      : \`<button class="primary switch-btn" data-account="\${escapeHtml(acc.name)}">Switch to</button>\`;
    const toggleBtn = acc.disabled
      ? \`<button class="enable-btn" data-account="\${escapeHtml(acc.name)}">Enable</button>\`
      : \`<button class="disable-btn" data-account="\${escapeHtml(acc.name)}">Disable</button>\`;
    const prioUp = \`<button class="prio-up-btn" data-account="\${escapeHtml(acc.name)}" data-priority="\${minPrio - 1}" title="Make highest priority">Prioritize</button>\`;
    const prioDown = \`<button class="prio-down-btn" data-account="\${escapeHtml(acc.name)}" data-priority="\${maxPrio + 1}" title="Make lowest priority">Deprioritize</button>\`;
    return \`
      <div class="account-card \${isCurrent ? 'current' : ''} \${acc.disabled ? 'disabled-card' : ''}">
        <div class="account-header">
          <div>
            <div class="account-title">
              <span class="account-name">\${escapeHtml(acc.name)}</span>
              <span class="badge \${statusClass}">\${acc.status || 'unknown'}\${acc.disabled ? ' · disabled' : ''}</span>
            </div>
            <div class="meta">\${acc.type}\${acc.orgName ? ' · ' + escapeHtml(acc.orgName) : ''} · priority \${acc.priority}\${acc.sessions ? ' · ' + acc.sessions + ' sess' : ''}</div>
          </div>
        </div>
        \${bars || '<div class="meta">No quota data yet</div>'}
        <div class="usage">\${usageText}\${usage.lastUsed ? ' · last used ' + new Date(usage.lastUsed).toLocaleTimeString() : ''}</div>
        <div class="account-actions">\${switchBtn}\${toggleBtn}\${prioUp}\${prioDown}</div>
      </div>
    \`;
  }).join('');
}

function renderRoutes(data) {
  const routes = data.routes || [];
  const section = document.getElementById('routes');
  if (!routes.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('routes-body').innerHTML = routes.map(r => {
    const pills = (r.accounts || []).map(a =>
      \`<span class="route-pill \${a.eligible ? 'eligible' : 'ineligible'}">\${escapeHtml(a.name)}</span>\`
    ).join('');
    const notes = [r.autocreated ? 'auto' : '', r.bucket ? 'bucket: ' + r.bucket : '', r.pinned ? 'pinned: ' + r.pinned : ''].filter(Boolean).join(' · ');
    return \`<tr><td>\${escapeHtml((r.match || []).join(', '))}</td><td><div class="route-accounts">\${pills}</div></td><td class="small">\${escapeHtml(notes)}</td></tr>\`;
  }).join('');
}

function renderContexts(data) {
  const contexts = (data.contexts && data.contexts.list) || [];
  const section = document.getElementById('contexts');
  if (!contexts.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('contexts-body').innerHTML = contexts.map(c => {
    const claimed = c.claimedAt ? new Date(c.claimedAt).toLocaleTimeString() : '-';
    return \`<tr>
      <td class="small">\${escapeHtml(c.sessionId.slice(0, 16))}...</td>
      <td>\${escapeHtml(c.projectSlug || '-')}</td>
      <td>\${c.prdId != null ? c.prdId : '-'}</td>
      <td>\${escapeHtml(c.beadId || '-')}</td>
      <td>\${escapeHtml(c.agentRef || '-')}</td>
      <td class="small">\${claimed}</td>
    </tr>\`;
  }).join('');
}

function renderUpstreamErrors(data) {
  const errors = data.upstreamErrors || [];
  const section = document.getElementById('errors');
  if (!errors.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  document.getElementById('errors-body').innerHTML = errors.slice().reverse().map(e => {
    const when = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '-';
    const kind = e.transient ? 'transient network' : 'upstream';
    return \`<tr>
      <td class="small">\${when}</td>
      <td>\${escapeHtml(e.account)}</td>
      <td>\${escapeHtml(e.message)}\${e.code ? \` <code>(\${escapeHtml(e.code)})</code>\` : ''}</td>
      <td class="small">\${kind}</td>
    </tr>\`;
  }).join('');
}

function formatNumber(n) {
  if (n == null) return '-';
  return n.toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


async function update() {
  try {
    const data = await fetchStatus();
    renderSummary(data);
    renderAccounts(data);
    renderContexts(data);
    renderUpstreamErrors(data);
    renderRoutes(data);
    setOnline(true);
    showError(null);
    document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    setOnline(false);
    showError('Lost connection to teamclaude: ' + err.message);
    document.getElementById('last-updated').textContent = 'Disconnected';
  }
}

async function reloadConfig() {
  const btn = document.getElementById('reload-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/teamclaude/reload', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    showToast('Config reloaded' + (data.added ? ' (' + data.added + ' added)' : ''));
    await update();
  } catch (err) {
    showToast('Reload failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function switchAccount(name) {
  try {
    const res = await fetch('/teamclaude/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    showToast('Switched to ' + name + (data.eligible ? '' : ' (not eligible: ' + data.reason + ')'));
    await update();
  } catch (err) {
    showToast('Switch failed: ' + err.message, 'error');
  }
}

async function setAccountPriority(name, priority) {
  try {
    const res = await fetch('/teamclaude/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: name, priority }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    showToast(\`Priority set: \${data.name} = \${data.priority}\`);
    await update();
  } catch (err) {
    showToast('Priority change failed: ' + err.message, 'error');
  }
}

async function setAccountDisabled(name, disabled) {
  try {
    const res = await fetch('/teamclaude/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: name, disabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + res.status);
    showToast(\`\${data.disabled ? 'Disabled' : 'Enabled'} \${data.name}\`);
    await update();
  } catch (err) {
    showToast('Enable/disable failed: ' + err.message, 'error');
  }
}

document.getElementById('accounts').addEventListener('click', e => {
  const btn = e.target.closest('.switch-btn');
  if (btn) switchAccount(btn.dataset.account);
  const prioUp = e.target.closest('.prio-up-btn');
  if (prioUp) setAccountPriority(prioUp.dataset.account, parseInt(prioUp.dataset.priority, 10));
  const prioDown = e.target.closest('.prio-down-btn');
  if (prioDown) setAccountPriority(prioDown.dataset.account, parseInt(prioDown.dataset.priority, 10));
  const disable = e.target.closest('.disable-btn');
  if (disable) setAccountDisabled(disable.dataset.account, true);
  const enable = e.target.closest('.enable-btn');
  if (enable) setAccountDisabled(enable.dataset.account, false);
});

pollTimer = setInterval(update, POLL_INTERVAL);
update();
</script>
</body>
</html>`;
