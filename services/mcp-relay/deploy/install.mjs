import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const source = path.dirname(fileURLToPath(import.meta.url));
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const backup = `/var/backups/media-mcp-relay/${stamp}-${process.pid}`;
const release = `/opt/media-mcp-relay/releases/${stamp}-${process.pid}`;
const site = '/etc/nginx/sites-enabled/24-music.de';
const snippet = '/etc/nginx/snippets/media-mcp-relay.conf';
const unit = '/etc/systemd/system/media-mcp-relay.service';
const current = '/opt/media-mcp-relay/current';
const stageUnit = `media-mcp-stage-${process.pid}`;
const health = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  return { status: response.status, text: (await response.text()).slice(0, 2000) };
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function requireUnusedPort(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`port_${port}_already_in_use`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`port_${port}_check_timeout`)); });
    socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(); else reject(new Error('port_check_failed')); });
  });
}
async function waitHealthy(base) {
  for (let i = 0; i < 40; i++) {
    try { const result = await health(`${base}/health`); if (result.status === 200 && JSON.parse(result.text).protocol === 1) return; } catch { }
    await delay(150);
  }
  throw new Error('relay_health_failed');
}
async function exercise(base) {
  const id = crypto.randomUUID();
  const agentToken = crypto.randomBytes(32).toString('base64url');
  const clientToken = crypto.randomBytes(32).toString('base64url');
  const agentHeaders = { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' };
  const clientHeaders = { Authorization: `Bearer ${clientToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const request = (route, init = {}) => fetch(`${base}${route}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(7000) });
  const registered = await request('/v1/installations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: id, kind: 'downloader', name: 'Deployment self-test', agentToken, clientToken }) });
  if (registered.status !== 201) throw new Error('self_test_enrollment_failed');
  await registered.body?.cancel();
  try {
    const poll = request(`/v1/agent/${id}/poll`, { headers: agentHeaders });
    await delay(100);
    const client = request(`/mcp/${id}`, { method: 'POST', headers: clientHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'self-test', version: '1' } } }) });
    const polled = await poll;
    const payload = await polled.json();
    const command = payload.commands?.[0];
    if (!command || command.principal?.installationId !== id || command.principal?.role !== 'client' || command.message.id !== 1) throw new Error('self_test_routing_failed');
    const answered = await request(`/v1/agent/${id}/results`, { method: 'POST', headers: agentHeaders, body: JSON.stringify({ requestId: command.requestId, response: { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'self-test', version: '1' } } } }) });
    if (answered.status !== 200) throw new Error('self_test_response_failed');
    await answered.body?.cancel();
    const received = await client;
    if (received.status !== 200 || !received.headers.get('mcp-session-id') || (await received.json()).result?.serverInfo?.name !== 'self-test') throw new Error('self_test_client_failed');
    const wrong = await request(`/mcp/${id}`, { headers: agentHeaders });
    if (wrong.status !== 401) throw new Error('self_test_authorization_failed');
    await wrong.body?.cancel();
  } finally {
    const revoked = await request(`/v1/agent/${id}`, { method: 'DELETE', headers: agentHeaders });
    if (revoked.status !== 200) throw new Error('self_test_revocation_failed');
    await revoked.body?.cancel();
  }
  const old = await request(`/mcp/${id}`, { headers: clientHeaders });
  if (old.status !== 401) throw new Error('self_test_old_key_valid');
  await old.body?.cancel();
  return id;
}

if (process.getuid?.() !== 0) throw new Error('root_required');
await requireUnusedPort(9872);
await requireUnusedPort(19872);
const originalSite = await fs.readFile(site, 'utf8');
const originalMain = await fs.readFile('/etc/nginx/nginx.conf', 'utf8');
if (originalSite.includes('media-mcp-relay.conf')) throw new Error('existing_deployment_requires_review');
const serviceBefore = run('systemctl', ['show', 'mdd-backup-api.service', '-p', 'MainPID', '-p', 'ActiveState']).trim();
const backupHealth = await health('https://downloader.24-music.de/backup-api/health');
const websiteHealth = await health('https://downloader.24-music.de/');
await fs.mkdir(backup, { recursive: true, mode: 0o700 });
await fs.writeFile(`${backup}/24-music.de.before`, originalSite, { mode: 0o600, flag: 'wx' });
await fs.writeFile(`${backup}/nginx.conf.before`, originalMain, { mode: 0o600, flag: 'wx' });
if (hash(await fs.readFile(`${backup}/24-music.de.before`)) !== hash(originalSite)) throw new Error('backup_verification_failed');
await fs.mkdir(release, { recursive: true, mode: 0o755 });
const serverSource = await fs.readFile(`${source}/server.mjs`);
await fs.writeFile(`${release}/server.mjs`, serverSource, { mode: 0o644, flag: 'wx' });
run('/usr/bin/node', ['--check', `${release}/server.mjs`]);
const stagedSites = `${backup}/staging/sites-enabled`;
await fs.mkdir(stagedSites, { recursive: true, mode: 0o700 });
for (const name of await fs.readdir('/etc/nginx')) {
  if (name !== 'nginx.conf' && name !== 'sites-enabled') await fs.symlink(`/etc/nginx/${name}`, `${backup}/staging/${name}`);
}
for (const name of await fs.readdir('/etc/nginx/sites-enabled')) await fs.copyFile(`/etc/nginx/sites-enabled/${name}`, path.join(stagedSites, name));
const stagedSnippet = `${backup}/staging/media-mcp-relay.conf`;
await fs.copyFile(`${source}/media-mcp-relay.conf`, stagedSnippet);
const marker = 'server_name downloader.24-music.de;';
const first = originalSite.indexOf(marker);
const second = originalSite.indexOf(marker, first + marker.length);
if (first < 0 || second < 0 || originalSite.indexOf(marker, second + marker.length) >= 0) throw new Error('unexpected_downloader_vhost_layout');
const inject = snippetPath => originalSite.slice(0, second + marker.length) + `\n    include ${snippetPath};` + originalSite.slice(second + marker.length);
await fs.writeFile(`${stagedSites}/24-music.de`, inject(stagedSnippet), { mode: 0o600 });
if (!originalMain.includes('/etc/nginx/sites-enabled/*')) throw new Error('unexpected_nginx_layout');
await fs.writeFile(`${backup}/staging/nginx.conf`, originalMain.replace('/etc/nginx/sites-enabled/*', `${stagedSites}/*`), { mode: 0o600 });
run('nginx', ['-t', '-c', `${backup}/staging/nginx.conf`]);
let activated = false;
let stageStarted = false;
let snippetInstalled = false;
let unitInstalled = false;
let siteInstalled = false;
let currentInstalled = false;
const previousCurrent = await fs.readlink(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
if (await fs.stat(unit).then(() => true, () => false)) throw new Error('existing_unit_requires_review');
if (await fs.stat(snippet).then(() => true, () => false)) throw new Error('existing_snippet_requires_review');
try {
  run('systemd-run', ['--unit', stageUnit, '--collect', '--property=DynamicUser=yes', `--property=StateDirectory=${stageUnit}`, '--setenv=HOST=127.0.0.1', '--setenv=PORT=19872', '--setenv=MCP_PREFIX=/mcp-relay', `--setenv=MCP_DATA_DIR=/var/lib/${stageUnit}`, '/usr/bin/node', `${release}/server.mjs`]);
  stageStarted = true;
  await waitHealthy('http://127.0.0.1:19872/mcp-relay');
  await exercise('http://127.0.0.1:19872/mcp-relay');
  run('systemctl', ['stop', stageUnit]);
  stageStarted = false;
  if (hash(await fs.readFile(site)) !== hash(originalSite) || hash(await fs.readFile('/etc/nginx/nginx.conf')) !== hash(originalMain)) throw new Error('nginx_changed_concurrently');
  await fs.symlink(release, `${current}.new-${process.pid}`);
  await fs.rename(`${current}.new-${process.pid}`, current);
  currentInstalled = true;
  await fs.copyFile(`${source}/media-mcp-relay.service`, unit);
  unitInstalled = true;
  run('systemd-analyze', ['verify', unit]);
  run('systemctl', ['daemon-reload']);
  run('systemctl', ['enable', '--now', 'media-mcp-relay.service']);
  await waitHealthy('http://127.0.0.1:9872/mcp-relay');
  await fs.copyFile(`${source}/media-mcp-relay.conf`, snippet);
  snippetInstalled = true;
  await fs.writeFile(`${site}.mcp-new`, inject(snippet), { mode: 0o644, flag: 'wx' });
  await fs.rename(`${site}.mcp-new`, site);
  siteInstalled = true;
  run('nginx', ['-t']);
  run('systemctl', ['reload', 'nginx']);
  await waitHealthy('https://downloader.24-music.de/mcp-relay');
  const fixtureId = await exercise('https://downloader.24-music.de/mcp-relay');
  const serviceAfter = run('systemctl', ['show', 'mdd-backup-api.service', '-p', 'MainPID', '-p', 'ActiveState']).trim();
  const backupAfter = await health('https://downloader.24-music.de/backup-api/health');
  const websiteAfter = await health('https://downloader.24-music.de/');
  if (serviceBefore !== serviceAfter || backupAfter.status !== backupHealth.status || websiteAfter.status !== websiteHealth.status) throw new Error('existing_service_check_failed');
  const report = { backup, release, sourceSha256: hash(serverSource), nginxBeforeSha256: hash(originalSite), nginxAfterSha256: hash(await fs.readFile(site)), fixtureId, fixtureRevoked: true, backupServiceUnchanged: true, backupHttpStatus: backupAfter.status, websiteHttpStatus: websiteAfter.status, relay: 'https://downloader.24-music.de/mcp-relay', verifiedAt: new Date().toISOString() };
  await fs.writeFile(`${backup}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  activated = true;
  console.log(JSON.stringify(report));
} finally {
  if (stageStarted) run('systemctl', ['stop', stageUnit]);
  if (!activated) {
    if (siteInstalled) await fs.writeFile(site, originalSite, { mode: 0o644 });
    if (snippetInstalled) await fs.unlink(snippet);
    if (unitInstalled) {
      try { run('systemctl', ['disable', '--now', 'media-mcp-relay.service']); } catch { }
      await fs.unlink(unit);
      run('systemctl', ['daemon-reload']);
    }
    if (currentInstalled) {
      await fs.unlink(current);
      if (previousCurrent) await fs.symlink(previousCurrent, current);
    }
    if (siteInstalled) { run('nginx', ['-t']); run('systemctl', ['reload', 'nginx']); }
  }
}
