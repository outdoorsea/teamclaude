# Switchyard integration

TeamClaude can attribute Claude API token usage to Switchyard work items and push the totals to a Switchyard instance. This is useful when many Claude Code sessions run against the same Switchyard project and you want to see which bead, PRD, PR, or agent drove the cost.

## What it does

- `teamclaude switchyard login` gets a Switchyard API token via browser OAuth and stores it in `~/.config/teamclaude.json`.
- `teamclaude mcp install` registers the TeamClaude MCP server with Claude Code.
- A Claude Code agent calls `claim_work` to say *"I am working on bead X / PRD Y / PR Z."*
- TeamClaude meters every request in that session.
- Every `switchyard.usageIntervalSeconds` (default 300), TeamClaude pushes a batch of rows to `POST /api/v1/projects/{tenant}/{project}/token-usage`.

Each row contains:

```json
{
  "bead_id": "...",
  "session_name": "...",
  "agent_ref": "...",
  "model": "...",
  "input": 123,
  "output": 45,
  "source": "push"
}
```

Prompt and response text are **not** sent — only token counts and attribution metadata.

## Setup

### 1. Log in to Switchyard

```bash
teamclaude switchyard login
```

This opens a browser, completes a device-code OAuth flow against `switchyard.work`, and writes the token to the config. Use `--base-url` for a self-hosted Switchyard instance.

### 2. Enable usage push

The login command writes the token, but you still need a `switchyard` block with an interval:

```json
{
  "switchyard": {
    "baseUrl": "https://switchyard.work",
    "apiKey": "sy_...",
    "usageIntervalSeconds": 300
  }
}
```

The interval can be set via the TUI settings screen or by hand. `0` disables pushing.

### 3. Register the MCP server

```bash
teamclaude mcp install
```

This adds a `teamclaude` MCP server entry to Claude Code's settings. The server talks to the running TeamClaude proxy over `http://127.0.0.1:3456` (override with `TEAMCLAUDE_MCP_URL`).

## Agent usage

Inside Claude Code, the agent can call:

- `claim_work` — start attributing this session to a work item.
- `release_work` — stop attributing.
- `get_context` — show the current claim.
- `list_active_contexts` — list all active claims across sessions.

`claim_work` accepts any of:

| Field | Meaning |
| --- | --- |
| `bead_id` | Switchyard bead / Gas City work item id |
| `tenant_slug` | Workspace slug |
| `project_slug` | Project slug |
| `project_id` | Canonical project id |
| `prd_id` | PRD the bead implements |
| `pr_number` | PR being revised, if any |
| `agent_ref` | Agent identifier, e.g. `switchyard-ops.builder` |
| `rig_name` | Gas City rig name |

Gas City rigs can export these values as environment variables (`SW_TENANT_SLUG`, `SW_PROJECT_SLUG`, `SW_PROJECT_ID`, `SW_PRD_ID`, `SW_PR_NUMBER`, `SW_BEAD_ID`, `GC_AGENT_REF`, `GC_RIG_NAME`) so the agent can call `claim_work` with no arguments.

## Dashboard

The web dashboard (`teamclaude attach` or `http://localhost:3456/dashboard/`) shows whether Switchyard push is enabled and the last push status.

## Privacy and data sharing

- The push is **disabled by default** until `switchyard.baseUrl` and an API key are configured.
- Only token counts and attribution metadata leave the machine; request/response bodies stay local.
- TeamClaude's other external destinations (`api.anthropic.com`, optional npm update checks, optional event logging) are documented in the codebase audit notes.
