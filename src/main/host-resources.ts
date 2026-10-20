import { execFile } from "node:child_process";

export type HostResourceInterval = {
  at: number;
  cpuPercent: number | null;
  cpuAvailablePercent: number | null;
  totalMemoryBytes: number | null;
  usedMemoryBytes: number | null;
  memoryUsedPercent: number | null;
  pagesInputPerSec: number | null;
  pageReadsPerSec: number | null;
  availableMemoryBytes: number | null;
  modifiedPageListBytes: number | null;
  standbyBytes: number | null;
  processes: Array<{ name: string; readMBps: number; writeMBps: number; pageFaultsPerSec: number }>;
  processCounts: Record<string, number>;
  disks: Array<{
    name: string;
    readMBps: number;
    writeMBps: number;
    totalMBps: number;
    cumulativeReadBytes: number;
    cumulativeWriteBytes: number;
    readIops: number;
    writeIops: number;
    avgReadMs: number | null;
    avgWriteMs: number | null;
    queueLength: number | null;
    busyPercent: number | null;
    idlePercent: number | null;
  }>;
  network: Array<{ name: string; receivedMBps: number; sentMBps: number; bandwidthMbps: number | null }>;
};

export type HostResourceReport = {
  supported: boolean;
  collectedAt: string;
  durationMs: number;
  computer: unknown;
  os: unknown;
  ec2: unknown;
  defender: unknown;
  license: unknown;
  physicalDisks: unknown;
  volumes: unknown;
  intervals: HostResourceInterval[];
  summary: Record<string, unknown>;
  errors: string[];
  measurementNotes: string[];
};

type RawDisk = Record<string, number | string | null>;
type RawSample = {
  at: number;
  disks?: RawDisk[] | RawDisk;
  network?: RawDisk[] | RawDisk;
  memory?: Record<string, number | null>;
  processes?: RawDisk[] | RawDisk;
  cpu?: number | null;
};

const MAX_SECONDS = 90;
let running: Promise<HostResourceReport> | null = null;

function buildScript(seconds: number): string {
  return `
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ errors = @() }
try { $cs = Get-CimInstance Win32_ComputerSystem; $result.computer = [ordered]@{ manufacturer = $cs.Manufacturer; model = $cs.Model; logicalProcessors = $cs.NumberOfLogicalProcessors; totalPhysicalMemoryBytes = $cs.TotalPhysicalMemory } } catch { $result.errors += "computer: $($_.Exception.Message)" }
try { $os = Get-CimInstance Win32_OperatingSystem; $result.os = [ordered]@{ caption = $os.Caption; version = $os.Version; lastBootUpTime = $os.LastBootUpTime.ToString('o') } } catch { $result.errors += "os: $($_.Exception.Message)" }
try { $result.physicalDisks = @(Get-PhysicalDisk | ForEach-Object { [ordered]@{ friendlyName = $_.FriendlyName; model = $_.Model; mediaType = [string]$_.MediaType; busType = [string]$_.BusType; sizeBytes = $_.Size; healthStatus = [string]$_.HealthStatus; serialNumber = $_.SerialNumber } }) } catch { $result.errors += "physicalDisks: $($_.Exception.Message)" }
try { $result.volumes = @(Get-Volume | Where-Object DriveLetter | ForEach-Object { [ordered]@{ driveLetter = [string]$_.DriveLetter; fileSystem = $_.FileSystem; sizeBytes = $_.Size; freeBytes = $_.SizeRemaining } }) } catch { $result.errors += "volumes: $($_.Exception.Message)" }
try {
  $token = Invoke-RestMethod -Method Put -Uri 'http://169.254.169.254/latest/api/token' -Headers @{ 'X-aws-ec2-metadata-token-ttl-seconds' = '60' } -TimeoutSec 2
  $headers = @{ 'X-aws-ec2-metadata-token' = $token }
  $result.ec2 = [ordered]@{
    instanceType = Invoke-RestMethod -Uri 'http://169.254.169.254/latest/meta-data/instance-type' -Headers $headers -TimeoutSec 2
    availabilityZone = Invoke-RestMethod -Uri 'http://169.254.169.254/latest/meta-data/placement/availability-zone' -Headers $headers -TimeoutSec 2
  }
} catch { $result.ec2 = $null }
try {
  $status = Get-MpComputerStatus
  $preference = Get-MpPreference
  $result.defender = [ordered]@{ realTimeProtectionEnabled = $status.RealTimeProtectionEnabled; antivirusEnabled = $status.AntivirusEnabled; onAccessProtectionEnabled = $status.OnAccessProtectionEnabled; exclusionPaths = @($preference.ExclusionPath); exclusionProcesses = @($preference.ExclusionProcess); scanAvgCpuLoadFactor = $preference.ScanAvgCPULoadFactor }
} catch { $result.defender = $null }
try { $result.license = @(Get-CimInstance SoftwareLicensingProduct -Filter "PartialProductKey IS NOT NULL AND ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f'" | ForEach-Object { [ordered]@{ name = $_.Name; licenseStatus = $_.LicenseStatus; gracePeriodRemainingMinutes = $_.GracePeriodRemaining; evaluationEndDate = $(if ($_.EvaluationEndDate) { $_.EvaluationEndDate.ToString('o') } else { $null }) } }) } catch { $result.license = $null }
$samples = New-Object System.Collections.ArrayList
$deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ${seconds * 1000}
do {
  $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $disks = @(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object Name -ne '_Total' | ForEach-Object { [ordered]@{ name = $_.Name; readBytes = [double]$_.DiskReadBytesPersec; writeBytes = [double]$_.DiskWriteBytesPersec; reads = [double]$_.DiskReadsPersec; writes = [double]$_.DiskWritesPersec; readTime = [double]$_.AvgDisksecPerRead; readBase = [double]$_.AvgDisksecPerRead_Base; writeTime = [double]$_.AvgDisksecPerWrite; writeBase = [double]$_.AvgDisksecPerWrite_Base; queue = [double]$_.CurrentDiskQueueLength; idle = [double]$_.PercentIdleTime; perfTime = [double]$_.Timestamp_PerfTime; perfFrequency = [double]$_.Frequency_PerfTime; sys100ns = [double]$_.Timestamp_Sys100NS } })
  $network = @(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | ForEach-Object { [ordered]@{ name = $_.Name; received = [double]$_.BytesReceivedPersec; sent = [double]$_.BytesSentPersec; bandwidth = [double]$_.CurrentBandwidth; perfTime = [double]$_.Timestamp_PerfTime; perfFrequency = [double]$_.Frequency_PerfTime } })
  $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $processes = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $_.Name -match '^(Multi|UnRAR|Rar|7z|java|ffmpeg|mkvmerge|MsMpEng|System$|node|electron)' } | ForEach-Object { [ordered]@{ name = $_.Name; read = [double]$_.IOReadBytesPersec; write = [double]$_.IOWriteBytesPersec; pageFaults = [double]$_.PageFaultsPersec; workingSet = [double]$_.WorkingSet; perfTime = [double]$_.Timestamp_PerfTime; perfFrequency = [double]$_.Frequency_PerfTime } })
  $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
  [void]$samples.Add([ordered]@{ at = $started; disks = $disks; network = $network; memory = [ordered]@{ availableBytes = [double]$memory.AvailableBytes; modifiedPageListBytes = [double]$memory.ModifiedPageListBytes; standbyBytes = [double]$memory.StandbyCacheNormalPriorityBytes + [double]$memory.StandbyCacheReserveBytes + [double]$memory.StandbyCacheCoreBytes }; processes = $processes; cpu = [double]$cpu })
  $samples[$samples.Count - 1].memory.totalBytes = $result.computer.totalPhysicalMemoryBytes
  $samples[$samples.Count - 1].memory.pagesInputPerSec = $memory.PagesInputPersec
  $samples[$samples.Count - 1].memory.pageReadsPerSec = $memory.PageReadsPersec
  $wait = 1000 - ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $started)
  if ($wait -gt 0 -and $started + 1000 -lt $deadline) { Start-Sleep -Milliseconds $wait }
} while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline)
$result.samples = $samples
$result | ConvertTo-Json -Depth 6 -Compress
`;
}

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim().slice(0, 2000)));
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

const list = <T>(value: T[] | T | undefined | null): T[] => Array.isArray(value) ? value : value ? [value] : [];
const num = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const counter32Delta = (current: unknown, previous: unknown): number => {
  const difference = num(current) - num(previous);
  return difference < 0 ? difference + 0x1_0000_0000 : difference;
};

function processDeltas(previous: RawSample, current: RawSample): HostResourceInterval["processes"] {
  const baseName = (name: unknown) => String(name).replace(/#\d+$/, "");
  const before = new Map(list(previous.processes).map(entry => [String(entry.name), entry]));
  const totals = new Map<string, { readMBps: number; writeMBps: number; pageFaultsPerSec: number }>();
  for (const entry of list(current.processes)) {
    const prior = before.get(String(entry.name));
    if (!prior) continue;
    const seconds = (num(entry.perfTime) - num(prior.perfTime)) / Math.max(1, num(entry.perfFrequency));
    if (seconds <= 0) continue;
    const readMBps = Math.max(0, num(entry.read) - num(prior.read)) / seconds / 1e6;
    const writeMBps = Math.max(0, num(entry.write) - num(prior.write)) / seconds / 1e6;
    const key = baseName(entry.name);
    const pageFaultsPerSec = Math.max(0, num(entry.pageFaults) - num(prior.pageFaults)) / seconds;
    const total = totals.get(key) ?? { readMBps: 0, writeMBps: 0, pageFaultsPerSec: 0 };
    totals.set(key, { readMBps: total.readMBps + readMBps, writeMBps: total.writeMBps + writeMBps, pageFaultsPerSec: total.pageFaultsPerSec + pageFaultsPerSec });
  }
  return [...totals].map(([name, value]) => ({ name, readMBps: round(value.readMBps), writeMBps: round(value.writeMBps), pageFaultsPerSec: round(value.pageFaultsPerSec, 0) }))
    .filter(entry => entry.readMBps > 0 || entry.writeMBps > 0)
    .sort((a, b) => b.readMBps + b.writeMBps - a.readMBps - a.writeMBps);
}

export function computeHostResourceIntervals(samples: RawSample[]): HostResourceInterval[] {
  const intervals: HostResourceInterval[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousDisks = new Map(list(previous.disks).map(disk => [String(disk.name), disk]));
    const disks = list(current.disks).flatMap(disk => {
      const before = previousDisks.get(String(disk.name));
      if (!before) return [];
      const seconds = (num(disk.perfTime) - num(before.perfTime)) / Math.max(1, num(disk.perfFrequency));
      if (seconds <= 0) return [];
      const reads = counter32Delta(disk.reads, before.reads);
      const writes = counter32Delta(disk.writes, before.writes);
      const readBase = counter32Delta(disk.readBase, before.readBase);
      const writeBase = counter32Delta(disk.writeBase, before.writeBase);
      const frequency = Math.max(1, num(disk.perfFrequency));
      const sysTicks = num(disk.sys100ns) - num(before.sys100ns);
      const idleTicks = num(disk.idle) - num(before.idle);
      return [{
        name: String(disk.name),
        readMBps: round((num(disk.readBytes) - num(before.readBytes)) / seconds / 1e6),
        writeMBps: round((num(disk.writeBytes) - num(before.writeBytes)) / seconds / 1e6),
        totalMBps: round((num(disk.readBytes) - num(before.readBytes) + num(disk.writeBytes) - num(before.writeBytes)) / seconds / 1e6),
        cumulativeReadBytes: num(disk.readBytes),
        cumulativeWriteBytes: num(disk.writeBytes),
        readIops: round(reads / seconds, 1),
        writeIops: round(writes / seconds, 1),
        avgReadMs: readBase > 0 ? round(counter32Delta(disk.readTime, before.readTime) / frequency / readBase * 1000) : null,
        avgWriteMs: writeBase > 0 ? round(counter32Delta(disk.writeTime, before.writeTime) / frequency / writeBase * 1000) : null,
        queueLength: Number.isFinite(num(disk.queue)) ? num(disk.queue) : null,
        busyPercent: sysTicks > 0 ? round(Math.min(100, Math.max(0, 100 - idleTicks / sysTicks * 100)), 1) : null,
        idlePercent: sysTicks > 0 ? round(Math.min(100, Math.max(0, idleTicks / sysTicks * 100)), 1) : null
      }];
    });
    const previousNetwork = new Map(list(previous.network).map(entry => [String(entry.name), entry]));
    const network = list(current.network).flatMap(entry => {
      const before = previousNetwork.get(String(entry.name));
      if (!before) return [];
      const seconds = (num(entry.perfTime) - num(before.perfTime)) / Math.max(1, num(entry.perfFrequency));
      if (seconds <= 0) return [];
      return [{
        name: String(entry.name),
        receivedMBps: round((num(entry.received) - num(before.received)) / seconds / 1e6),
        sentMBps: round((num(entry.sent) - num(before.sent)) / seconds / 1e6),
        bandwidthMbps: num(entry.bandwidth) > 0 ? round(num(entry.bandwidth) / 1e6, 0) : null
      }];
    });
    intervals.push({
      at: num(current.at),
      cpuPercent: current.cpu === undefined || current.cpu === null ? null : num(current.cpu),
      cpuAvailablePercent: current.cpu == null ? null : Math.max(0, 100 - num(current.cpu)),
      totalMemoryBytes: current.memory?.totalBytes ?? null,
      usedMemoryBytes: current.memory?.totalBytes != null && current.memory?.availableBytes != null
        ? Math.max(0, current.memory.totalBytes - current.memory.availableBytes) : null,
      memoryUsedPercent: current.memory?.totalBytes && current.memory?.availableBytes != null
        ? round(Math.max(0, current.memory.totalBytes - current.memory.availableBytes) / current.memory.totalBytes * 100) : null,
      pagesInputPerSec: current.memory?.pagesInputPerSec ?? null,
      pageReadsPerSec: current.memory?.pageReadsPerSec ?? null,
      availableMemoryBytes: current.memory?.availableBytes ?? null,
      modifiedPageListBytes: current.memory?.modifiedPageListBytes ?? null,
      standbyBytes: current.memory?.standbyBytes ?? null,
      processes: processDeltas(previous, current),
      processCounts: list(current.processes).reduce<Record<string, number>>((counts, entry) => {
        const name = String(entry.name).replace(/#\d+$/, "");
        counts[name] = (counts[name] || 0) + 1;
        return counts;
      }, {}),
      disks,
      network
    });
  }
  return intervals;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))];
}

function stats(values: number[]): Record<string, number | null> {
  const clean = values.filter(Number.isFinite);
  return {
    mean: clean.length ? round(clean.reduce((sum, value) => sum + value, 0) / clean.length) : null,
    p50: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    max: clean.length ? Math.max(...clean) : null
  };
}

export function summarizeHostResourceIntervals(intervals: HostResourceInterval[]): Record<string, unknown> {
  const diskNames = [...new Set(intervals.flatMap(interval => interval.disks.map(disk => disk.name)))];
  const networkNames = [...new Set(intervals.flatMap(interval => interval.network.map(entry => entry.name)))];
  const pick = <T extends { name: string }>(entries: T[], name: string): T | undefined => entries.find(entry => entry.name === name);
  return {
    cpuPercent: stats(intervals.map(interval => interval.cpuPercent ?? Number.NaN)),
    memoryUsedPercent: stats(intervals.map(interval => interval.memoryUsedPercent ?? Number.NaN)),
    availableMemoryBytes: stats(intervals.map(interval => interval.availableMemoryBytes ?? Number.NaN)),
    pagesInputPerSec: stats(intervals.map(interval => interval.pagesInputPerSec ?? Number.NaN)),
    pageReadsPerSec: stats(intervals.map(interval => interval.pageReadsPerSec ?? Number.NaN)),
    disks: Object.fromEntries(diskNames.map(name => {
      const entries = intervals.map(interval => pick(interval.disks, name)).filter(Boolean) as HostResourceInterval["disks"];
      return [name, {
        readMBps: stats(entries.map(entry => entry.readMBps)),
        writeMBps: stats(entries.map(entry => entry.writeMBps)),
        totalMBps: stats(entries.map(entry => entry.readMBps + entry.writeMBps)),
        totalIops: stats(entries.map(entry => entry.readIops + entry.writeIops)),
        avgReadMs: stats(entries.map(entry => entry.avgReadMs ?? Number.NaN)),
        avgWriteMs: stats(entries.map(entry => entry.avgWriteMs ?? Number.NaN)),
        queueLength: stats(entries.map(entry => entry.queueLength ?? Number.NaN)),
        busyPercent: stats(entries.map(entry => entry.busyPercent ?? Number.NaN))
      }];
    })),
    network: Object.fromEntries(networkNames.map(name => {
      const entries = intervals.map(interval => pick(interval.network, name)).filter(Boolean) as HostResourceInterval["network"];
      return [name, {
        receivedMBps: stats(entries.map(entry => entry.receivedMBps)),
        sentMBps: stats(entries.map(entry => entry.sentMBps)),
        bandwidthMbps: entries[0]?.bandwidthMbps ?? null
      }];
    }))
  };
}

async function collect(seconds: number): Promise<HostResourceReport> {
  const startedAt = Date.now();
  const report: HostResourceReport = { supported: process.platform === "win32", collectedAt: new Date().toISOString(), durationMs: 0, computer: null, os: null, ec2: null, defender: null, license: null, physicalDisks: [], volumes: [], intervals: [], summary: {}, errors: [], measurementNotes: [
    "Process I/O includes file, network and device I/O; it is not physical disk throughput.",
    "Process page faults include soft faults. PagesInputPerSec and PageReadsPerSec describe system-wide hard-fault disk reads, not exclusively pagefile activity.",
    "Disk busy percentage describes the guest-visible device, not guaranteed remaining bandwidth or the physical NVMe backend."
  ] };
  if (!report.supported) return report;
  try {
    const parsed = JSON.parse(await runPowerShell(buildScript(seconds), seconds * 1000 + 20_000)) as Record<string, unknown>;
    report.computer = parsed.computer ?? null;
    report.os = parsed.os ?? null;
    report.ec2 = parsed.ec2 ?? null;
    report.defender = parsed.defender ?? null;
    report.license = parsed.license ?? null;
    report.physicalDisks = parsed.physicalDisks ?? [];
    report.volumes = parsed.volumes ?? [];
    report.errors.push(...list(parsed.errors as string[] | string | undefined).map(String));
    report.intervals = computeHostResourceIntervals(list(parsed.samples as RawSample[] | RawSample | undefined));
    report.summary = summarizeHostResourceIntervals(report.intervals);
  } catch (error) {
    report.errors.push(String(error instanceof Error ? error.message : error));
  }
  report.durationMs = Date.now() - startedAt;
  return report;
}

export function sampleHostResources(seconds: number): Promise<HostResourceReport> {
  const bounded = Math.max(1, Math.min(MAX_SECONDS, Math.floor(seconds) || 10));
  if (!running) {
    running = collect(bounded).finally(() => { running = null; });
  }
  return running;
}
