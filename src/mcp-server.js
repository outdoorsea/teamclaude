// MCP server that exposes TeamClaude work-context tools to Claude Code.
// Communicates with the running TeamClaude proxy over HTTP on localhost.
//
// Usage:
//   TEAMCLAUDE_MCP_URL=http://127.0.0.1:3456 node src/mcp-server.js
//
// The server speaks JSON-RPC 2.0 over stdin/stdout, implementing the minimal
// MCP surface: initialize, notifications/initialized, tools/list, tools/call.

import { readFileSync } from 'node:fs';

const CONTROL_URL = process.env.TEAMCLAUDE_MCP_URL || 'http://127.0.0.1:3456';
const API_KEY = process.env.TEAMCLAUDE_API_KEY || '';

// Gas City can set these env vars before spawning an agent. The MCP server uses
// them as defaults so the agent only has to call claim_work() with the fields it
// knows, or even with no arguments if every field is provided by the rig.
function envDefaults() {
  return {
    tenant_slug: process.env.SW_TENANT_SLUG || null,
    project_slug: process.env.SW_PROJECT_SLUG || null,
    project_id: process.env.SW_PROJECT_ID ? parseInt(process.env.SW_PROJECT_ID, 10) : null,
    prd_id: process.env.SW_PRD_ID ? parseInt(process.env.SW_PRD_ID, 10) : null,
    pr_number: process.env.SW_PR_NUMBER ? parseInt(process.env.SW_PR_NUMBER, 10) : null,
    bead_id: process.env.SW_BEAD_ID || null,
    agent_ref: process.env.GC_AGENT_REF || process.env.SW_AGENT_REF || null,
    rig_name: process.env.GC_RIG_NAME || process.env.SW_RIG_NAME || null,
  };
}

function mergeDefaults(args) {
  const defs = envDefaults();
  const merged = { ...defs };
  for (const [k, v] of Object.entries(args)) {
    if (v != null && v !== '') merged[k] = v;
  }
  return merged;
}

const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const TOOLS = [
  {
    name: 'set_scope',
    description: 'Set the Switchyard workspace/project scope for this Claude Code session. Optional — claim_work can include the same fields.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_slug: { type: 'string', description: 'Switchyard workspace slug' },
        project_slug: { type: 'string', description: 'Switchyard project slug' },
        project_id: { type: 'number', description: 'Canonical Switchyard project id' },
      },
    },
  },
  {
    name: 'claim_work',
    description: 'Claim a bead/work item so TeamClaude attributes API usage to the right project, PRD, PR, and agent. Replaces any existing claim for this session. Gas City can pre-populate all fields via env vars (SW_TENANT_SLUG, SW_PROJECT_SLUG, SW_PROJECT_ID, SW_PRD_ID, SW_PR_NUMBER, SW_BEAD_ID, GC_AGENT_REF, GC_RIG_NAME), so the agent may call this with no arguments.',
    inputSchema: {
      type: 'object',
      properties: {
        bead_id: { type: 'string', description: 'Switchyard bead id / Gas City work item id (or SW_BEAD_ID env var)' },
        tenant_slug: { type: 'string', description: 'Switchyard workspace slug (or SW_TENANT_SLUG env var)' },
        project_slug: { type: 'string', description: 'Switchyard project slug (or SW_PROJECT_SLUG env var)' },
        project_id: { type: 'number', description: 'Canonical Switchyard project id (or SW_PROJECT_ID env var)' },
        prd_id: { type: 'number', description: 'PRD this bead implements (or SW_PRD_ID env var)' },
        pr_number: { type: 'number', description: 'PR being revised, if any (or SW_PR_NUMBER env var)' },
        agent_ref: { type: 'string', description: 'Agent identifier, e.g. switchyard-ops.builder (or GC_AGENT_REF env var)' },
        rig_name: { type: 'string', description: 'Gas City rig name (or GC_RIG_NAME env var)' },
      },
    },
  },
  {
    name: 'release_work',
    description: 'Release the current claim. Usage attribution stops until the next claim_work.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_context',
    description: 'Return the current session\'s active work context.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_active_contexts',
    description: 'List all currently active claims across sessions (operator view).',
    inputSchema: { type: 'object', properties: {} },
  },
];

function logError(msg, err) {
  console.error(`[teamclaude-mcp] ${msg}:`, err?.message || err);
}

async function callControl(method, path, body = null) {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function makeText(content) {
  return { type: 'text', text: content };
}

function renderContext(ctx) {
  if (!ctx) return 'No active work context.';
  const parts = [];
  if (ctx.tenantSlug) parts.push(`workspace: ${ctx.tenantSlug}`);
  if (ctx.projectSlug) parts.push(`project: ${ctx.projectSlug}`);
  if (ctx.projectId) parts.push(`project_id: ${ctx.projectId}`);
  if (ctx.prdId) parts.push(`prd: ${ctx.prdId}`);
  if (ctx.prNumber) parts.push(`pr: #${ctx.prNumber}`);
  if (ctx.beadId) parts.push(`bead: ${ctx.beadId}`);
  if (ctx.agentRef) parts.push(`agent: ${ctx.agentRef}`);
  if (ctx.rigName) parts.push(`rig: ${ctx.rigName}`);
  if (ctx.claimedAt) parts.push(`claimed_at: ${ctx.claimedAt}`);
  return parts.join('\n');
}

async function handleToolCall(name, rawArgs, sessionId) {
  // Merge Gas City env var defaults. claim_work and set_scope pick up whatever
  // the rig exported; get_context/release_work ignore args.
  const args = (name === 'claim_work' || name === 'set_scope') ? mergeDefaults(rawArgs || {}) : (rawArgs || {});
  switch (name) {
    case 'set_scope': {
      const ctx = await callControl('POST', '/teamclaude/context', {
        session_id: sessionId,
        tenant_slug: args.tenant_slug,
        project_slug: args.project_slug,
        project_id: args.project_id,
      });
      return { content: [makeText(`Scope set.\n${renderContext(ctx.context)}`)] };
    }
    case 'claim_work': {
      const ctx = await callControl('POST', '/teamclaude/context', {
        session_id: sessionId,
        action: 'claim',
        tenant_slug: args.tenant_slug,
        project_slug: args.project_slug,
        project_id: args.project_id,
        prd_id: args.prd_id,
        pr_number: args.pr_number,
        bead_id: args.bead_id,
        agent_ref: args.agent_ref,
        rig_name: args.rig_name,
      });
      return { content: [makeText(`Work claimed.\n${renderContext(ctx.context)}`)] };
    }
    case 'release_work': {
      const ctx = await callControl('POST', '/teamclaude/context', {
        session_id: sessionId,
        action: 'release',
      });
      return { content: [makeText(ctx.context ? `Work released.\n${renderContext(ctx.context)}` : 'No active claim to release.')] };
    }
    case 'get_context': {
      const ctx = await callControl('GET', `/teamclaude/context?session_id=${encodeURIComponent(sessionId || '')}`);
      return { content: [makeText(renderContext(ctx.context))] };
    }
    case 'list_active_contexts': {
      const data = await callControl('GET', '/teamclaude/contexts');
      const contexts = data.contexts || [];
      if (!contexts.length) return { content: [makeText('No active work contexts.')] };
      const lines = contexts.map(c => `- ${c.sessionId}: ${c.projectSlug || '(no project)'} / ${c.beadId || '(no bead)'}${c.agentRef ? ` (${c.agentRef})` : ''}`);
      return { content: [makeText(lines.join('\n'))] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

class McpSession {
  constructor(send) {
    this.send = send;
    this.initialized = false;
    this.sessionId = null;
  }

  async handleMessage(msg) {
    if (msg.method === 'initialize') {
      this.initialized = true;
      this.respond(msg.id, {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'teamclaude-mcp', version: PACKAGE_VERSION },
      });
      return;
    }

    if (msg.method === 'notifications/initialized') {
      return;
    }

    if (!this.initialized) {
      if (msg.id != null) {
        this.respond(msg.id, null, { code: -32002, message: 'Server not initialized' });
      }
      return;
    }

    if (msg.method === 'tools/list') {
      this.respond(msg.id, { tools: TOOLS });
      return;
    }

    if (msg.method === 'tools/call') {
      try {
        const result = await handleToolCall(msg.params?.name, msg.params?.arguments || {}, this.sessionId);
        this.respond(msg.id, result);
      } catch (err) {
        logError('tool call failed', err);
        this.respond(msg.id, null, { code: -32603, message: err.message });
      }
      return;
    }

    if (msg.id != null) {
      this.respond(msg.id, null, { code: -32601, message: `Method not found: ${msg.method}` });
    }
  }

  respond(id, result, error) {
    const msg = { jsonrpc: '2.0', id };
    if (error) msg.error = error;
    else msg.result = result;
    this.send(msg);
  }
}

export function runMcpServer() {
  const session = new McpSession((msg) => {
    console.log(JSON.stringify(msg));
  });

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        session.handleMessage(msg).catch((err) => logError('handler error', err));
      } catch (err) {
        logError('invalid JSON', err);
      }
    }
  });

  process.stdin.on('end', () => {
    // Let the process exit naturally once pending async work (e.g. the final
    // tool-call response) is done. Explicit process.exit(0) here races with
    // buffered stdin data and can truncate replies.
  });

  // If the session id is provided by the MCP client via env, use it; otherwise
  // each tool call falls back to the control endpoint's own header (which only
  // works when the client passes x-claude-code-session-id). Most real clients
  // do not expose the session id to the MCP server, so the control endpoint
  // accepts session_id in the POST body.
  session.sessionId = process.env.CLAUDE_CODE_SESSION_ID || null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMcpServer();
}
