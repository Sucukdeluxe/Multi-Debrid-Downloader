import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const current = '/opt/media-mcp-relay/current';
const data = '/var/lib/media-mcp-relay';
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const backup = `/var/backups/media-mcp-relay/${stamp}-update-${process.pid}`;
const release = `/opt/media-mcp-relay/releases/${stamp}-${process.pid}`;
const stage = `media-mcp-update-${process.pid}`;
const health = async url => { const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); if (response.status !== 200 || (await response.json()).protocol !== 1) throw new Error('health_failed'); };
async function snapshot(directory) {
  const result = {};
  for (const name of (await fs.readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).sort()) result[name] = hash(await fs.readFile(path.join(directory, name)));
  return result;
}
if (process.getuid?.() !== 0) throw new Error('root_required');
const previous = await fs.readlink(current);
if (!/^\/opt\/media-mcp-relay\/releases\/[0-9]+-[0-9]+$/.test(previous)) throw new Error('unknown_current_release');
const oldSource = await fs.readFile(`${previous}/server.mjs`);
if (hash(oldSource) !== process.argv[2]) throw new Error('source_changed_since_review');
const nextSource = await fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs'));
const serviceBefore = run('systemctl', ['show', 'mdd-backup-api.service', '-p', 'MainPID', '-p', 'ActiveState']);
await fs.mkdir(`${backup}/registry`, { recursive: true, mode: 0o700 });
await fs.writeFile(`${backup}/server.mjs`, oldSource, { flag: 'wx', mode: 0o600 });
const before = await snapshot(data);
for (const name of Object.keys(before)) await fs.copyFile(path.join(data, name), path.join(backup, 'registry', name));
if (JSON.stringify(before) !== JSON.stringify(await snapshot(data)) || JSON.stringify(before) !== JSON.stringify(await snapshot(`${backup}/registry`))) throw new Error('registry_backup_unstable');
await fs.mkdir(release, { recursive: true, mode: 0o755 });
await fs.writeFile(`${release}/server.mjs`, nextSource, { flag: 'wx', mode: 0o644 });
run('/usr/bin/node', ['--check', `${release}/server.mjs`]);
let stageStarted = false;
let switched = false;
let completed = false;
try {
  run('systemd-run', ['--unit', stage, '--collect', '--property=DynamicUser=yes', `--property=StateDirectory=${stage}`, '--setenv=HOST=127.0.0.1', '--setenv=PORT=19872', `--setenv=MCP_DATA_DIR=/var/lib/${stage}`, '/usr/bin/node', `${release}/server.mjs`]);
  stageStarted = true;
  for (let i = 0; ; i++) {
    try { await health('http://127.0.0.1:19872/health'); break; }
    catch { if (i === 30) throw new Error('stage_start_failed'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const id = crypto.randomUUID();
  const agentToken = crypto.randomBytes(32).toString('base64url');
  const payload = JSON.stringify({ installationId: id, kind: 'downloader', name: 'Repeated-save self-test', agentToken, clientToken: crypto.randomBytes(32).toString('base64url') });
  for (let i = 0; i < 9; i++) {
    const response = await fetch('http://127.0.0.1:19872/v1/installations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(5000) });
    if (response.status !== (i === 0 ? 201 : 409)) throw new Error('repeat_registration_test_failed');
    await response.body?.cancel();
  }
  const revoked = await fetch(`http://127.0.0.1:19872/v1/agent/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${agentToken}` } });
  if (revoked.status !== 200) throw new Error('stage_revocation_failed');
  await revoked.body?.cancel();
  run('systemctl', ['stop', stage]); stageStarted = false;
  if (await fs.readlink(current) !== previous || JSON.stringify(before) !== JSON.stringify(await snapshot(data))) throw new Error('live_state_changed');
  await fs.symlink(release, `${current}.next-${process.pid}`);
  await fs.rename(`${current}.next-${process.pid}`, current); switched = true;
  run('systemctl', ['restart', 'media-mcp-relay.service']);
  for (let i = 0; ; i++) {
    try { await health('https://downloader.24-music.de/mcp-relay/health'); break; }
    catch { if (i === 30) throw new Error('live_health_failed'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (JSON.stringify(before) !== JSON.stringify(await snapshot(data)) || serviceBefore !== run('systemctl', ['show', 'mdd-backup-api.service', '-p', 'MainPID', '-p', 'ActiveState'])) throw new Error('existing_data_changed');
  const report = { backup, previous, release, sourceSha256: hash(nextSource), priorSourceSha256: hash(oldSource), registryEntries: Object.keys(before).length, registryUnchanged: true, repeatedSaveTest: true, backupServiceUnchanged: true };
  await fs.writeFile(`${backup}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  completed = true;
  console.log(JSON.stringify(report));
} finally {
  if (stageStarted) run('systemctl', ['stop', stage]);
  if (switched && !completed) {
    await fs.symlink(previous, `${current}.rollback-${process.pid}`);
    await fs.rename(`${current}.rollback-${process.pid}`, current);
    run('systemctl', ['restart', 'media-mcp-relay.service']);
  }
}
