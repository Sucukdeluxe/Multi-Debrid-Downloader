const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomFillSync, createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { performance } = require('node:perf_hooks');

const inspectScript = String.raw`
$ErrorActionPreference='Stop'
$r=[ordered]@{errors=@()}
try { $r.drivers=@(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceClass -in @('SCSIAdapter','HDC','DiskDrive') -or $_.DeviceName -match 'VirtIO|Balloon' } | Select-Object DeviceName,DeviceClass,DriverVersion,DriverDate,DriverProviderName,InfName,IsSigned) } catch { $r.errors+='drivers-unavailable' }
try { $r.disks=@(Get-CimInstance Win32_DiskDrive | Select-Object Index,Model,InterfaceType,Size,Status,SCSIPort,BytesPerSector,FirmwareRevision); $r.storage=@(Get-Disk | Select-Object Number,FriendlyName,BusType,HealthStatus,OperationalStatus,Size,LogicalSectorSize,PhysicalSectorSize,IsBoot,IsSystem) } catch { $r.errors+='disks-unavailable' }
try { $r.events=@(Get-WinEvent -FilterHashtable @{LogName='System';Id=7,9,11,15,51,55,98,129,153,157,140;StartTime=(Get-Date).AddDays(-1)} -MaxEvents 100 -ErrorAction Stop | Where-Object {$_.ProviderName -match 'disk|stor|ntfs|volmgr|partmgr'} | ForEach-Object {[ordered]@{at=$_.TimeCreated.ToUniversalTime().ToString('o');id=$_.Id;provider=$_.ProviderName;level=$_.Level;message=$_.Message.Substring(0,[Math]::Min(1500,$_.Message.Length))}}) } catch { if ($_.FullyQualifiedErrorId -notmatch 'NoMatchingEventsFound') {$r.errors+='events-unavailable'}; $r.events=@() }
try { $r.memoryPolicy=Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' | Select-Object LargeSystemCache,DisablePagingExecutive,ClearPageFileAtShutdown; $r.paging=@(Get-CimInstance Win32_PageFileUsage | Select-Object AllocatedBaseSize,CurrentUsage,PeakUsage,TempPageFile); $r.os=Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,FreePhysicalMemory,TotalVisibleMemorySize,FreeVirtualMemory,TotalVirtualMemorySize,LastBootUpTime } catch { $r.errors+='memory-unavailable' }
try { $r.services=@(Get-CimInstance Win32_SystemDriver | Where-Object {$_.Name -match 'vioscsi|viostor|balloon|storport|stornvme|storahci|disk|ntfs'} | Select-Object Name,State,StartMode) } catch { $r.errors+='services-unavailable' }
try { $r.processes=@(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 50 ProcessName,Id,WorkingSet64,PrivateMemorySize64,CPU) } catch { $r.errors+='processes-unavailable' }
try { $r.filters=@(& "$env:SystemRoot\System32\fltmc.exe" filters 2>$null); if ($LASTEXITCODE -ne 0) {$r.errors+='filters-unavailable'} } catch { $r.errors+='filters-unavailable' }
try { $r.power=@(& "$env:SystemRoot\System32\powercfg.exe" /getactivescheme 2>$null) } catch { $r.errors+='power-unavailable' }
try { $r.tasks=@(Get-ScheduledTask | Where-Object { $_.TaskName -match 'memory|rammap|standby|cache|clean|optim' } | Select-Object TaskName,TaskPath,State) } catch { $r.errors+='tasks-unavailable' }
$r | ConvertTo-Json -Depth 7 -Compress
`;

function describe(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1),
    p95Ms: sorted[Math.floor((sorted.length - 1) * .95)] || 0, maxMs: sorted.at(-1) || 0 };
}

async function runFileProbe({ directory = os.tmpdir(), blocks = 128, blockBytes = 1024 * 1024, signal } = {}) {
  signal?.throwIfAborted();
  const scratch = await fs.mkdtemp(path.join(directory, 'mdd-storage-probe-'));
  const report = { volume: path.parse(path.resolve(scratch)).root, bytesPerMode: blocks * blockBytes, modes: [], cleaned: false,
    note: 'Buffered file I/O on a new temporary file with explicit flush and complete SHA-256 readback. Readback can be served by Windows cache; not a raw-device benchmark.' };
  const expected = Array.from({ length: blocks }, () => '');
  const buffer = randomFillSync(Buffer.alloc(blockBytes));
  try {
    for (const mode of ['sequential', 'strided']) {
      signal?.throwIfAborted();
      const file = path.join(scratch, mode + '.bin');
      let handle;
      const writes = [], reads = [];
      const started = performance.now();
      try {
        handle = await fs.open(file, 'wx+');
        for (let index = 0; index < blocks; index++) {
          signal?.throwIfAborted();
          const block = mode === 'sequential' ? index : (index * 73) % blocks;
          buffer.writeUInt32LE(block, 0);
          expected[block] = createHash('sha256').update(buffer).digest('hex');
          const at = performance.now();
          let offset = 0;
          while (offset < buffer.length) {
            const result = await handle.write(buffer, offset, buffer.length - offset, block * blockBytes + offset);
            if (!result.bytesWritten) throw Error('PROBE_SHORT_WRITE');
            offset += result.bytesWritten;
          }
          writes.push(performance.now() - at);
        }
        const at = performance.now();
        await handle.sync();
        const flushMs = performance.now() - at;
        for (let block = 0; block < blocks; block++) {
          signal?.throwIfAborted();
          const at = performance.now();
          let offset = 0;
          while (offset < buffer.length) {
            const result = await handle.read(buffer, offset, buffer.length - offset, block * blockBytes + offset);
            if (!result.bytesRead) throw Error('PROBE_SHORT_READ');
            offset += result.bytesRead;
          }
          reads.push(performance.now() - at);
          if (createHash('sha256').update(buffer).digest('hex') !== expected[block]) throw Error('PROBE_HASH_MISMATCH');
        }
        report.modes.push({ mode, bytes: blocks * blockBytes, write: describe(writes), read: describe(reads), flushMs,
          elapsedMs: performance.now() - started, verified: true });
      } finally { await handle?.close(); await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }
  } finally { await fs.rmdir(scratch); report.cleaned = true; }
  return report;
}

async function inspect(signal) {
  const { stdout } = await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', inspectScript],
    { windowsHide: true, shell: false, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, signal });
  return JSON.parse(stdout.replace(/^\uFEFF/, ''));
}

async function runWindowsProbe(mode, signal) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'mdd-windows-probe-'));
  let result;
  try {
    const { stdout } = await promisify(execFile)('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'storage-windows-probe.ps1'), '-Mode', mode, '-ScratchDirectory', scratch],
      { windowsHide: true, shell: false, encoding: 'utf8', timeout: 110000, maxBuffer: 4 * 1024 * 1024, ...(mode === 'defender-trace' ? {} : { signal }) });
    const marker = 'MDD_STORAGE_RESULT=';
    const offset = stdout.lastIndexOf(marker);
    if (offset < 0) throw Error('PROBE_RESULT_MISSING');
    result = JSON.parse(stdout.slice(offset + marker.length).split(/\r?\n/)[0]);
  } finally {
    for (const name of ['buffered.bin', 'write-through.bin', 'defender.etl']) {
      await fs.unlink(path.join(scratch, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await fs.rmdir(scratch);
  }
  return { ...result, cleaned: true };
}

if (parentPort) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 120000);
  parentPort.on('message', message => { if (message === 'cancel') abort.abort(); });
  Promise.resolve().then(() => workerData.mode === 'inspect' ? inspect(abort.signal)
    : workerData.mode === 'file-test' ? runFileProbe({ signal: abort.signal })
    : ['windows-detail', 'native-file-test', 'defender-trace'].includes(workerData.mode) ? runWindowsProbe(workerData.mode, abort.signal) : Promise.reject(Error('INVALID_PROBE_MODE')))
    .then(result => parentPort.postMessage({ result }), error => parentPort.postMessage({ error: /^PROBE_/.test(error.message) ? error.message : abort.signal.aborted ? 'PROBE_CANCELLED' : 'PROBE_FAILED' }))
    .finally(() => { clearTimeout(timer); parentPort.close(); });
}

module.exports = { runFileProbe, inspectScript, runWindowsProbe };
