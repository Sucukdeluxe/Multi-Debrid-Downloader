param(
  [ValidateSet('windows-detail','native-file-test','defender-trace')][string]$Mode,
  [string]$ScratchDirectory
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$scratch = [IO.Path]::GetFullPath($ScratchDirectory).TrimEnd('\')
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($scratch) -ne $temp -or [IO.Path]::GetFileName($scratch) -notlike 'mdd-windows-probe-*' -or !(Test-Path -LiteralPath $scratch -PathType Container)) { throw 'INVALID_SCRATCH' }
$result = [ordered]@{ mode=$Mode; at=[DateTime]::UtcNow.ToString('o'); errors=@() }
function TimingSummary($Values) {
  $sorted = @($Values | Sort-Object)
  if (!$sorted.Count) { return @{count=0;meanMs=0;maxMs=0;p95Ms=0} }
  return @{count=$sorted.Count;meanMs=($sorted | Measure-Object -Average).Average;maxMs=$sorted[-1];p95Ms=$sorted[[Math]::Floor(($sorted.Count-1)*0.95)]}
}
if ($Mode -eq 'windows-detail') {
  try { $result.dirty=@(& "$env:SystemRoot\System32\fsutil.exe" dirty query $env:SystemDrive 2>$null); $result.dirtyExit=$LASTEXITCODE } catch { $result.errors+='dirty-unavailable' }
  try { $result.ntfs=@(& "$env:SystemRoot\System32\fsutil.exe" fsinfo ntfsinfo $env:SystemDrive 2>$null); $result.ntfsExit=$LASTEXITCODE } catch { $result.errors+='ntfs-unavailable' }
  try { $result.trim=@(& "$env:SystemRoot\System32\fsutil.exe" behavior query DisableDeleteNotify 2>$null); $result.trimExit=$LASTEXITCODE } catch { $result.errors+='trim-unavailable' }
  try { $result.diskPolicy=Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\Disk' | Select-Object TimeOutValue; $result.virtioPolicy=@('viostor','vioscsi') | ForEach-Object { $p="HKLM:\SYSTEM\CurrentControlSet\Services\$_"; if(Test-Path $p){[ordered]@{name=$_;settings=Get-ItemProperty $p | Select-Object Start,ErrorControl,Group;parameters=Get-ItemProperty "$p\Parameters" -ErrorAction SilentlyContinue | Select-Object QueueDepth,NumberOfRequests,UseMSI}} } } catch { $result.errors+='policy-unavailable' }
  try { $result.driverFiles=@('viostor.sys','vioscsi.sys','storport.sys','ntfs.sys') | ForEach-Object { $f=Get-Item -LiteralPath "$env:SystemRoot\System32\drivers\$_" -ErrorAction SilentlyContinue; if($f){[ordered]@{name=$f.Name;version=$f.VersionInfo.FileVersion;modified=$f.LastWriteTimeUtc.ToString('o')}} } } catch { $result.errors+='driver-files-unavailable' }
  try { $result.memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object AvailableMBytes,CommittedBytes,CommitLimit,CacheBytes,ModifiedPageListBytes,PagesInputPersec,PageReadsPersec,PagesOutputPersec,PageWritesPersec } catch { $result.errors+='memory-unavailable' }
  try { $result.activeTasks=@(Get-ScheduledTask | Where-Object {$_.State -eq 'Running'} | Select-Object TaskName,TaskPath) } catch { $result.errors+='tasks-unavailable' }
  try { $result.defender=Get-MpComputerStatus | Select-Object AMProductVersion,AMEngineVersion,AntivirusSignatureVersion,RealTimeProtectionEnabled,FullScanStartTime,FullScanEndTime,QuickScanStartTime,QuickScanEndTime; $cmd=Get-Command New-MpPerformanceRecording -ErrorAction SilentlyContinue; $result.defenderTimedRecording=($null -ne $cmd -and $cmd.Parameters.ContainsKey('Seconds')) } catch { $result.errors+='defender-unavailable' }
  try { $result.volume=Get-Volume -DriveLetter $env:SystemDrive.TrimEnd(':') | Select-Object FileSystem,HealthStatus,OperationalStatus,Size,SizeRemaining,AllocationUnitSize; $result.scratchAttributes=[string](Get-Item -LiteralPath $scratch).Attributes } catch { $result.errors+='volume-unavailable' }
  try { $result.storageHealth=@(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,HealthStatus,OperationalStatus,Size); $result.reliability=@(Get-PhysicalDisk | Get-StorageReliabilityCounter | Select-Object DeviceId,Temperature,Wear,ReadErrorsTotal,ReadErrorsUncorrected,WriteErrorsTotal,WriteErrorsUncorrected,ReadLatencyMax,WriteLatencyMax,FlushLatencyMax,PowerOnHours) } catch { $result.errors+='reliability-unavailable' }
  try {
    $first=@{}
    Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object { $first[[string]$_.IDProcess]=$_ }
    Start-Sleep -Seconds 10
    $cpuCount=[Environment]::ProcessorCount
    $rows=@(Get-CimInstance Win32_PerfRawData_PerfProc_Process | ForEach-Object {
      $old=$first[[string]$_.IDProcess]
      if($old -and $old.Name -eq $_.Name -and $_.IDProcess -gt 0 -and $_.Name -ne '_Total') {
        $seconds=([double]$_.Timestamp_Sys100NS-[double]$old.Timestamp_Sys100NS)/10000000
        if($seconds -gt 0) {[ordered]@{name=$_.Name;pid=$_.IDProcess;seconds=$seconds;cpuPercent=([double]$_.PercentProcessorTime-[double]$old.PercentProcessorTime)/10000000/$seconds/$cpuCount*100;readBps=([double]$_.IOReadBytesPersec-[double]$old.IOReadBytesPersec)/$seconds;writeBps=([double]$_.IOWriteBytesPersec-[double]$old.IOWriteBytesPersec)/$seconds;privateBytes=$_.PrivateBytes;workingSet=$_.WorkingSet}}
      }
    })
    $result.processes=@($rows | Sort-Object { $_.readBps+$_.writeBps } -Descending | Select-Object -First 25)
    $result.monitoredProcesses=@($rows | Where-Object {$_.name -match 'MsMpEng|System$|SearchIndexer|TiWorker|TrustedInstaller|defrag|chkdsk|Multi-|7z|unrar|ffmpeg'})
    $result.processNote='Process I/O includes network and device I/O; it is not physical disk I/O attribution.'
  } catch { $result.errors+='process-sampling-unavailable' }
}
if ($Mode -eq 'native-file-test') {
  $result.engine='Separate Windows PowerShell .NET FileStream process, no Node file I/O or application queue'
  $result.volume=[IO.Path]::GetPathRoot($scratch)
  $result.modes=@()
  $buffer=New-Object byte[] 1048576
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buffer)
  $rng.Dispose()
  $hash=[Security.Cryptography.SHA256]::Create()
  $expected=[Convert]::ToBase64String($hash.ComputeHash($buffer))
  try {
    foreach($kind in @('buffered','write-through')) {
      $watch=[Diagnostics.Stopwatch]::StartNew()
      $file=[IO.Path]::Combine($scratch,"$kind.bin")
      $flags=[IO.FileOptions]::SequentialScan
      if($kind -eq 'write-through'){$flags=$flags -bor [IO.FileOptions]::WriteThrough}
      $stream=$null
      $writes=New-Object 'Collections.Generic.List[double]'
      $reads=New-Object 'Collections.Generic.List[double]'
      try {
        $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None,1048576,$flags)
        for($block=0;$block -lt 64 -and $watch.Elapsed.TotalSeconds -lt 30;$block++) {
          $t=[Diagnostics.Stopwatch]::StartNew()
          $stream.Write($buffer,0,$buffer.Length)
          $writes.Add($t.Elapsed.TotalMilliseconds)
        }
        $t=[Diagnostics.Stopwatch]::StartNew()
        $stream.Flush($true)
        $flush=$t.Elapsed.TotalMilliseconds
        $stream.Position=0
        for($block=0;$block -lt $writes.Count;$block++) {
          $t=[Diagnostics.Stopwatch]::StartNew()
          $offset=0
          while($offset -lt $buffer.Length){$n=$stream.Read($buffer,$offset,$buffer.Length-$offset);if(!$n){throw 'PROBE_SHORT_READ'};$offset+=$n}
          $reads.Add($t.Elapsed.TotalMilliseconds)
          if([Convert]::ToBase64String($hash.ComputeHash($buffer)) -ne $expected){throw 'PROBE_HASH_MISMATCH'}
        }
        $result.modes+=@{mode=$kind;bytes=$writes.Count*$buffer.Length;fullSize=($writes.Count -eq 64);write=TimingSummary $writes;read=TimingSummary $reads;flushMs=$flush;elapsedMs=$watch.Elapsed.TotalMilliseconds;verified=$true}
      } finally { if($stream){$stream.Dispose()} }
    }
  } finally {$hash.Dispose()}
  $result.note='Buffered and write-through I/O both retain Windows cache semantics. Readback may be cached; not a raw-device benchmark.'
}
if ($Mode -eq 'defender-trace') {
  $command=Get-Command New-MpPerformanceRecording -ErrorAction SilentlyContinue
  if(!$command -or !$command.Parameters.ContainsKey('Seconds')) { $result.available=$false; $result.reason='timed-defender-recording-unavailable' }
  else {
    $trace=[IO.Path]::Combine($scratch,'defender.etl')
    try {
      New-MpPerformanceRecording -RecordTo $trace -Seconds 20 -ErrorAction Stop | Out-Null
      $result.available=$true
      $result.seconds=20
      $result.report=Get-MpPerformanceReport -Path $trace -TopProcesses 10 -TopFiles 10 -TopScans 10 -Raw -ErrorAction Stop
      $result.traceBytes=(Get-Item -LiteralPath $trace).Length
    } catch { $result.available=$false; $result.reason='defender-recording-failed'; $result.errorType=$_.Exception.GetType().Name; $result.errorId=$_.FullyQualifiedErrorId }
  }
}
[Console]::Out.WriteLine('MDD_STORAGE_RESULT=' + ($result | ConvertTo-Json -Depth 12 -Compress))
