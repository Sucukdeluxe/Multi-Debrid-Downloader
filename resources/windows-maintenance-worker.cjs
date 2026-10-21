const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { parentPort, workerData } = require('node:worker_threads');
const errorPath = path.join(workerData.directory, 'launcher-error.log');
const child = execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'windows-maintenance.ps1'), '-JobDirectory', workerData.directory
], { windowsHide: true, detached: true, maxBuffer: 65536 }, (error, stdout, stderr) => {
  const statusPath = path.join(workerData.directory, 'status.json');
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (['completed', 'failed', 'awaiting-reboot'].includes(status.state)) return;
    const details = (stderr || stdout || error?.message || '').slice(-4000);
    fs.writeFileSync(errorPath, details);
    fs.writeFileSync(statusPath, JSON.stringify({ ...status, state: 'failed', error: `Windows maintenance process exited (${error?.code || 0}): ${details}` }));
  } catch {}
});
child.once('spawn', () => { parentPort.postMessage({ started: true, pid: child.pid }); parentPort.close(); });
child.once('error', error => { parentPort.postMessage({ error: error.message }); parentPort.close(); });
