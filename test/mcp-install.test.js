import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMcpServer, uninstallMcpServer } from '../src/mcp-install.js';

// The stdio server registers as `teamclaude-work`. An earlier version used
// plain `teamclaude`, the name upstream's docs give its HTTP management MCP,
// so the migration must take back only its own entry.

const STDIO = { type: 'stdio', command: 'teamclaude', args: ['mcp'], env: {} };
const HTTP = { type: 'http', url: 'http://localhost:3456/teamclaude/mcp' };

async function inTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'tc-mcp-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    await mkdir('.claude', { recursive: true });
    return await fn(join(dir, '.claude', 'settings.local.json'));
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
}

const read = async p => JSON.parse(await readFile(p, 'utf8'));

test('install registers teamclaude-work and replaces the old stdio entry', () => inTempProject(async path => {
  await writeFile(path, JSON.stringify({ mcpServers: { teamclaude: STDIO, other: HTTP } }));
  const result = await installMcpServer('local');
  assert.equal(result.action, 'updated');
  const servers = (await read(path)).mcpServers;
  assert.deepEqual(Object.keys(servers).sort(), ['other', 'teamclaude-work']);
  assert.deepEqual(servers['teamclaude-work'].args, ['mcp']);
}));

test('install leaves an HTTP registration named teamclaude alone', () => inTempProject(async path => {
  await writeFile(path, JSON.stringify({ mcpServers: { teamclaude: HTTP } }));
  assert.equal((await installMcpServer('local')).action, 'installed');
  const servers = (await read(path)).mcpServers;
  assert.deepEqual(servers.teamclaude, HTTP);
  assert.ok(servers['teamclaude-work']);
}));

test('uninstall removes the new and the old stdio entry, never the HTTP one', () => inTempProject(async path => {
  await writeFile(path, JSON.stringify({ mcpServers: { teamclaude: STDIO } }));
  assert.equal((await uninstallMcpServer('local')).action, 'removed');
  assert.equal((await read(path)).mcpServers, undefined);

  await writeFile(path, JSON.stringify({ mcpServers: { teamclaude: HTTP } }));
  assert.equal((await uninstallMcpServer('local')).action, 'not-found');
  assert.deepEqual((await read(path)).mcpServers.teamclaude, HTTP);
}));
