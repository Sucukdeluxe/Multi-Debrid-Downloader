import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { protectForCurrentUser } from './mcp-headers.mjs';

export function parseConnectionCode(raw) {
  const prefix = 'media-mcp:v1:';
  if (typeof raw !== 'string' || raw.length > 16_384 || !raw.trim().startsWith(prefix)) throw new Error('Invalid connection code');
  let value;
  let url;
  try {
    value = JSON.parse(Buffer.from(raw.trim().slice(prefix.length), 'base64url').toString('utf8'));
    url = new URL(value.url);
  } catch { throw new Error('Invalid connection code'); }
  if (value.v !== 1 || !['downloader', 'uploader'].includes(value.kind) || !/^[0-9a-f-]{36}$/.test(value.installationId) || !/^[A-Za-z0-9_-]{43}$/.test(value.token) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(`/mcp/${value.installationId}`)) throw new Error('Invalid connection code');
  return value;
}

export async function connectMcp(codeFile, configFile = path.join(os.homedir(), '.codex', 'config.toml')) {
  if (typeof codeFile !== 'string' || codeFile.startsWith('media-mcp:')) throw new Error('Provide a private code file, not a connection code on the command line');
  const code = parseConnectionCode(await fs.readFile(codeFile, 'utf8'));
  const name = `media_${code.kind}_${code.installationId.replaceAll('-', '').slice(0, 12)}`;
  const config = await fs.readFile(configFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  if (new RegExp(`\\[mcp_servers\\.${name}(?:\\]|\\.)`).test(config)) throw new Error('This installation is already configured');
  const directory = path.join(path.dirname(configFile), 'mcp-credentials');
  await fs.mkdir(directory, { recursive: true });
  const credentialFile = path.join(directory, `${name}.bin`);
  const encrypted = await protectForCurrentUser(Buffer.from(JSON.stringify({ token: code.token })));
  await fs.writeFile(credentialFile, encrypted, { flag: 'wx', mode: 0o600 });
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mcp-headers.mjs');
  const quote = value => `"${value.replaceAll('"', '')}"`;
  const command = [process.execPath, helper, credentialFile].map(quote).join(' ');
  const block = `\n[mcp_servers.${name}]\nurl = ${JSON.stringify(code.url)}\nhttp_headers_helper = ${JSON.stringify(command)}\ntool_timeout_sec = 120\n`;
  if (config) await fs.writeFile(`${configFile}.${crypto.randomUUID()}.backup`, config, { flag: 'wx', mode: 0o600 });
  const temporary = `${configFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, config + block, { flag: 'wx', mode: 0o600 });
  if ((await fs.readFile(configFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })) !== config) {
    await fs.unlink(temporary);
    await fs.unlink(credentialFile);
    throw new Error('Codex configuration changed; retry without overwriting concurrent changes');
  }
  await fs.rename(temporary, configFile);
  return { name, url: code.url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node scripts/connect-mcp.mjs <private-code-file> [config.toml]');
    const result = await connectMcp(process.argv[2], process.argv[3]);
    process.stdout.write(`Configured ${result.name}. Restart the MCP connection in Codex.\n`);
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'MCP setup failed'}\n`); process.exitCode = 1; }
}
