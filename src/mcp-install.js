// Install / uninstall the TeamClaude MCP server from Claude Code's config.
// Supports user scope (~/.claude.json) and project scope (.claude/settings.json).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SERVER_NAME = 'teamclaude';

function getConfigPaths(scope) {
  if (scope === 'user') {
    return { path: join(homedir(), '.claude.json'), backup: true };
  }
  if (scope === 'project' || scope === 'local') {
    return { path: resolve('.claude/settings.local.json'), backup: true };
  }
  throw new Error(`Unknown scope "${scope}". Use user, project, or local.`);
}

async function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}

async function writeJson(path, data) {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function makeServerEntry() {
  return {
    type: 'stdio',
    command: 'teamclaude',
    args: ['mcp'],
    env: {
      TEAMCLAUDE_MCP_URL: 'http://127.0.0.1:3456',
    },
  };
}

export async function installMcpServer(scope = 'user') {
  const { path, backup } = getConfigPaths(scope);
  const config = await readJson(path);

  if (backup && existsSync(path)) {
    await writeFile(`${path}.teamclaude-backup`, await readFile(path, 'utf8'), 'utf8');
  }

  config.mcpServers = config.mcpServers || {};
  const existing = config.mcpServers[SERVER_NAME];
  config.mcpServers[SERVER_NAME] = makeServerEntry();

  await writeJson(path, config);

  return {
    scope,
    path,
    action: existing ? 'updated' : 'installed',
  };
}

export async function uninstallMcpServer(scope = 'user') {
  const { path } = getConfigPaths(scope);
  const config = await readJson(path);

  if (!config.mcpServers || !config.mcpServers[SERVER_NAME]) {
    return { scope, path, action: 'not-found' };
  }

  delete config.mcpServers[SERVER_NAME];
  if (Object.keys(config.mcpServers).length === 0) {
    delete config.mcpServers;
  }

  await writeJson(path, config);
  return { scope, path, action: 'removed' };
}

export function renderInstallResult(result) {
  if (result.action === 'not-found') {
    return `TeamClaude MCP server was not registered in ${result.path}`;
  }
  return `TeamClaude MCP server ${result.action} in ${result.scope} scope: ${result.path}\nReload Claude Code tools with /mcp`;
}
