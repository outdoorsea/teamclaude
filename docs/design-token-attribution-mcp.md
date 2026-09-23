# Design: Per-work-item token attribution via a TeamClaude MCP server

**Status:** implemented — see [docs/switchyard.md](switchyard.md) for user-facing docs and `src/mcp-server.js`, `src/usage-pusher.js`, `src/work-context.js`, `src/switchyard-auth.js` for the code.  
**Context:** Switchyard runs remotely at `switchyard.work`. Gas City rigs run locally and proxy Claude Code through TeamClaude. Switchyard needs per-project / per-PRD / per-PR / per-bead token usage, but it cannot see the local Claude Code sessions that incur the cost.

## The idea

Add a small stdio MCP server to TeamClaude. The Claude Code agent on the local rig uses it to tell TeamClaude:

- *"I am starting work on bead X / PRD Y / PR Z."*
- *"I am done; report the tokens this session spent."*

TeamClaude already proxies every API request, so it can meter the session. The MCP call gives it the Switchyard metadata needed to attribute that spend.

## Why an MCP server?

- **Topology match:** Switchyard is remote; TeamClaude is local. Metering must happen on the rig.
- **User toggle:** Gas City users can add or remove an MCP server in their config to opt in or out.
- **Correlation is possible:** Claude Code exposes `CLAUDE_CODE_SESSION_ID` to stdio MCP server subprocesses ([Claude Code env vars docs](https://code.claude.com/docs/en/env-vars)), so the MCP server can correlate its call with the session TeamClaude is already tracking.
- **Minimal agent burden:** the agent only provides metadata it already knows. Token math and delivery live in TeamClaude.

## Proposed MCP tools

### `teamclaude_tag_session`

Marks the current Claude Code session as working on a specific Switchyard item.

```json
{
  "bead_id": "sw-jfn.4",
  "prd_id": 293,
  "pr_number": 1672,
  "project": "switchyard",
  "tenant": "outdoorsea"
}
```

The MCP server reads `CLAUDE_CODE_SESSION_ID` from its own environment and asks the local TeamClaude daemon to store:

```
session_id  ->  { bead_id, prd_id, pr_number, project, tenant, tagged_at }
```

### `teamclaude_release_session`

Finalizes metering for the current session and returns the token totals.

```json
{
  "bead_id": "sw-jfn.4"
}
```

Returns:

```json
{
  "bead_id": "sw-jfn.4",
  "session_id": "session_...",
  "model": "claude-sonnet-4-6",
  "input": 12345,
  "cache_creation": 0,
  "cache_read": 56789,
  "output": 4321
}
```

On release, TeamClaude clears the tag and optionally pushes the row to Switchyard.

### `teamclaude_session_usage` (optional)

Live read of how much the current session has spent so far, without closing the metered window.

## TeamClaude changes required

1. **Per-session token accumulator.** While proxying responses, TeamClaude should sum usage for each `x-claude-code-session-id` it sees. The exact source may be:
   - `usage` blocks in streamed SSE responses,
   - `anthropic-ratelimit-*` headers,
   - or a combination.

2. **Tag store.** A small in-memory map keyed by `session_id`. Old entries should expire after a session has been idle for a defined TTL (e.g., 2 hours).

3. **Release + delivery.** When a session is released, TeamClaude produces one usage row. Delivery can be:

   - **Direct push (recommended):** TeamClaude is configured with `SWITCHYARD_API_TOKEN` and `SWITCHYARD_BASE_URL` and `POST`s to:
     ```
     POST /api/v1/projects/{tenant}/{project}/token-usage
     ```
     using the existing batch row shape Switchyard already accepts.

   - **Return-and-forward:** the MCP tool returns the row and the agent forwards it through `switchyard-mcp`. This avoids giving TeamClaude Switchyard credentials but is less reliable because it depends on the agent making a second call.

4. **MCP server binary.** Add a subcommand such as:
   ```bash
   teamclaude mcp
   ```
   It should start a stdio MCP server that talks to the running TeamClaude daemon over its local control API.

## Gas City user configuration

A user opts in by adding the MCP server to their Claude Code / Gas City config:

```json
{
  "mcpServers": {
    "teamclaude": {
      "command": "teamclaude",
      "args": ["mcp"]
    }
  }
}
```

Removing that block disables the feature.

TeamClaude direct push also needs a Switchyard token:

```json
{
  "proxy": { ... },
  "switchyard": {
    "baseUrl": "https://switchyard.work",
    "apiToken": "sy_..."
  }
}
```

## Agent prompt contract

The agent must be told to call the tools around its work:

- Call `teamclaude_tag_session` when it starts executing a bead or PRD task.
- Call `teamclaude_release_session` when it finishes, before exiting.

This can be added to the relevant Gas City role prompts or formula instructions.

## Reliability and fallback

The main risk is the agent forgetting to call `release_session` (or crashing before it can). Mitigations:

- Have TeamClaude also accept an environment-provided bead id (e.g., `SWITCHYARD_BEAD_ID`) and auto-tag a session on first use if exactly one tag is unambiguous.
- Keep a short TTL on tags and flush any tagged session that goes idle.
- Continue to use Switchyard's existing **transcript backfill** (`switchyard-companion serve` with `SWITCHYARD_COMPANION_TOKEN_BACKFILL=1`) as the fallback / audit source. The MCP path gives live, attributed numbers; the backfill gives ground-truth reconciliation from disk.

## Open questions

- Should `teamclaude_tag_session` allow re-tagging a session mid-flight, or only once?
- Should released rows be buffered and retried, or fail loudly?
- How should TeamClaude attribute tokens when the upstream response does not include explicit usage (e.g., some third-party backends)?
