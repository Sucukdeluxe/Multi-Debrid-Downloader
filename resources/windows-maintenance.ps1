param([Parameter(Mandatory=$true)][string]$JobDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$directory = [IO.Path]::GetFullPath($JobDirectory)
$root = [IO.Path]::GetDirectoryName($directory)
if ([IO.Path]::GetFileName($root) -ne 'windows-maintenance' -or [IO.Path]::GetFileName($directory) -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid maintenance directory.' }
$request = Get-Content -LiteralPath (Join-Path $directory 'request.json') -Raw | ConvertFrom-Json
$statusPath = Join-Path $directory 'status.json'
$state = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$state | Add-Member -NotePropertyName pid -NotePropertyValue $PID -Force
$lock = $null
function Save-State([string]$phase, $result = $null) {
  $state.state = $phase
  $state | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
  if ($null -ne $result) { $state | Add-Member -NotePropertyName result -NotePropertyValue $result -Force }
  $temporary = Join-Path $directory 'status.tmp'
  [IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 16), [Text.UTF8Encoding]::new($false))
  [IO.File]::Replace($temporary, $statusPath, [NullString]::Value)
}
function Get-UpdateDescription($update) {
  return [ordered]@{
    id = $update.Identity.UpdateID
    revision = $update.Identity.RevisionNumber
    title = $update.Title
    kb = @($update.KBArticleIDs)
    downloaded = $update.IsDownloaded
    maxDownloadBytes = $update.MaxDownloadSize
    eulaAccepted = $update.EulaAccepted
    requiresInteraction = $update.InstallationBehavior.CanRequestUserInput
    rebootBehavior = [int]$update.InstallationBehavior.RebootBehavior
    categories = @($update.Categories | ForEach-Object { $_.Name })
  }
}
function Is-RebootPending {
  $system = New-Object -ComObject Microsoft.Update.SystemInfo
  return [bool]$system.RebootRequired
}
function Restore-Services($services) {
  foreach ($service in @($services)) {
    try {
      $startup = switch ($service.startMode) { 'Auto' { 'Automatic' } 'Manual' { 'Manual' } 'Disabled' { 'Disabled' } default { $null } }
      if ($startup) { Set-Service -Name $service.name -StartupType $startup }
      if ($service.state -eq 'Running') { Start-Service -Name $service.name -ErrorAction SilentlyContinue }
      else { Stop-Service -Name $service.name -Force -ErrorAction SilentlyContinue }
    } catch {}
  }
}
$serviceBackup = @()
try {
  $lock = [IO.File]::Open((Join-Path $root 'maintenance.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  Save-State 'preflight'
  $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows maintenance requires an elevated application.' }
  $osInfo = Get-CimInstance Win32_OperatingSystem
  if ($request.backupConfirmed -ne $true -or $request.expectedBuild -ne '20348' -or $osInfo.BuildNumber -ne '20348' -or $osInfo.ProductType -eq 1) { throw 'Expected Windows Server 2022 and confirmed VM backup.' }
  if ($request.action -notin @('scan', 'install', 'restore', 'abort', 'reboot')) { throw 'Invalid action.' }
  if ($request.action -eq 'restore') {
    if ($request.sourceJobId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid source job.' }
    $sourcePath = Join-Path (Join-Path $root $request.sourceJobId) 'status.json'
    $source = Get-Content -LiteralPath $sourcePath -Raw | ConvertFrom-Json
    if (-not $source.result.servicesBefore) { throw 'No service backup found.' }
    Restore-Services $source.result.servicesBefore
    Save-State 'completed' @{ restoredFrom=$request.sourceJobId; services=$source.result.servicesBefore }
    return
  }
  if ($request.action -eq 'abort') {
    if ($request.sourceJobId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid source job.' }
    $sourcePath = Join-Path (Join-Path $root $request.sourceJobId) 'status.json'
    $source = Get-Content -LiteralPath $sourcePath -Raw | ConvertFrom-Json
    $serviceSource = $source
    if ($request.scanId -match '^[a-fA-F0-9-]{36}$') { $serviceSource = Get-Content -LiteralPath (Join-Path (Join-Path $root $request.scanId) 'status.json') -Raw | ConvertFrom-Json }
    if ($source.state -ne 'installing' -or -not $source.pid -or -not $serviceSource.result.servicesBefore) { throw 'Only an active installing job can be aborted.' }
    Restore-Services $serviceSource.result.servicesBefore
    $sourceState = [ordered]@{ id=$source.id; action=$source.action; state='aborted'; startedAt=$source.startedAt; updatedAt=[DateTime]::UtcNow.ToString('o'); result=$source.result; abortReason='No status progress for more than 30 minutes; process tree stopped by explicit maintenance request.' }
    $temporary = Join-Path (Split-Path $sourcePath) 'status.abort.tmp'
    [IO.File]::WriteAllText($temporary, ($sourceState | ConvertTo-Json -Depth 16), [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporary, $sourcePath, [NullString]::Value)
    Stop-Process -Id ([int]$source.pid) -Force -ErrorAction SilentlyContinue
    Save-State 'completed' @{ abortedJob=$request.sourceJobId; services=$serviceSource.result.servicesBefore }
    return
  }
  if ($request.action -eq 'reboot') {
    if ($request.sourceJobId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid installation job.' }
    $source = Get-Content -LiteralPath (Join-Path (Join-Path $root $request.sourceJobId) 'status.json') -Raw | ConvertFrom-Json
    if ($source.action -ne 'install' -or $source.state -notin @('completed','failed') -or $source.result.rebootRequired -ne $true -or -not (Is-RebootPending)) { throw 'No completed installation requiring a restart.' }
    $processing = @(Get-Process -Name '7z','7za','unrar','ffmpeg','ffprobe' -ErrorAction SilentlyContinue)
    if ($processing.Count -gt 0) { throw 'Extraction or media processing is still running.' }
    Save-State 'awaiting-reboot' @{ rebootRequired = $true; forced = $false }
    Start-Sleep -Seconds 10
    & "$env:SystemRoot\System32\shutdown.exe" /r /t 0 /d p:2:4 /c 'Approved Windows update maintenance'
    if ($LASTEXITCODE -ne 0) { throw "Restart request failed: $LASTEXITCODE" }
  } else {
    $serviceBackup = @('BITS','wuauserv','UsoSvc') | ForEach-Object {
      $service = Get-CimInstance Win32_Service -Filter "Name='$_'"
      [ordered]@{ name=$service.Name; startMode=$service.StartMode; state=$service.State }
    }
    $backupPath = Join-Path $directory 'services-before.json'
    $backupText = $serviceBackup | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($backupPath, $backupText, [Text.UTF8Encoding]::new($false))
    if ([IO.File]::ReadAllText($backupPath) -ne $backupText) { throw 'Service backup verification failed.' }
    Save-State 'enabling-update-services' @{ servicesBefore = $serviceBackup; osBuild = $osInfo.Version }
    foreach ($service in $serviceBackup) {
      if ($service.startMode -eq 'Disabled') { Set-Service -Name $service.name -StartupType Manual }
    }
    Start-Service -Name BITS
    Start-Service -Name wuauserv
    $session = New-Object -ComObject Microsoft.Update.Session
    $session.ClientApplicationID = 'Multi-Debrid-Downloader Windows Maintenance'
    $searcher = $session.CreateUpdateSearcher()
    Save-State 'searching'
    $search = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
    if ([int]$search.ResultCode -ne 2) { throw "Update search incomplete: $($search.ResultCode)" }
    $available = @($search.Updates | ForEach-Object { Get-UpdateDescription $_ })
    if ($request.action -eq 'scan') {
      Save-State 'completed' @{ updates=$available; rebootRequired=(Is-RebootPending); servicesBefore=$serviceBackup; osBuild=$osInfo.Version }
    } else {
      if ($request.scanId -notmatch '^[a-fA-F0-9-]{36}$' -or @($request.updates).Count -lt 1 -or @($request.updates).Count -gt 100) { throw 'Invalid update selection.' }
      $source = Get-Content -LiteralPath (Join-Path (Join-Path $root $request.scanId) 'status.json') -Raw | ConvertFrom-Json
      if ($source.action -ne 'scan' -or $source.state -ne 'completed') { throw 'Update scan is not complete.' }
      $collection = New-Object -ComObject Microsoft.Update.UpdateColl
      foreach ($selected in $request.updates) {
        $approved = @($source.result.updates | Where-Object { $_.id -eq $selected.id -and $_.revision -eq $selected.revision })
        $matches = @($search.Updates | Where-Object { $_.Identity.UpdateID -eq $selected.id -and $_.Identity.RevisionNumber -eq $selected.revision })
        if ($approved.Count -ne 1 -or $matches.Count -ne 1 -or $matches[0].InstallationBehavior.CanRequestUserInput) { throw 'Selected update is no longer applicable or requires user interaction.' }
        if (-not $matches[0].EulaAccepted) { $matches[0].AcceptEula() }
        [void]$collection.Add($matches[0])
      }
      $installer = $session.CreateUpdateInstaller()
      if ($installer.IsBusy) { throw 'Another Windows installation is active.' }
      Save-State 'downloading' @{ updates=@($collection | ForEach-Object { Get-UpdateDescription $_ }) }
      $downloader = $session.CreateUpdateDownloader()
      $downloader.Updates = $collection
      $download = $downloader.Download()
      $downloadResults = @(for ($i=0; $i -lt $collection.Count; $i++) {
        $entry = $download.GetUpdateResult($i)
        [ordered]@{ id=$collection.Item($i).Identity.UpdateID; resultCode=[int]$entry.ResultCode; hresult=$entry.HResult; downloaded=$collection.Item($i).IsDownloaded }
      })
      if ([int]$download.ResultCode -ne 2 -or @($downloadResults | Where-Object { -not $_.downloaded }).Count -gt 0) {
        Save-State 'failed' @{ stage='download'; resultCode=[int]$download.ResultCode; updates=$downloadResults; rebootRequired=(Is-RebootPending) }
      } else {
        Save-State 'installing' @{ updates=@($collection | ForEach-Object { Get-UpdateDescription $_ }); downloadResults=$downloadResults }
        $installer.Updates = $collection
        $installer.ForceQuiet = $true
        $installer.AllowSourcePrompts = $false
        $installation = $installer.Install()
        $results = @(for ($i=0; $i -lt $collection.Count; $i++) {
          $entry = $installation.GetUpdateResult($i)
          [ordered]@{ id=$collection.Item($i).Identity.UpdateID; title=$collection.Item($i).Title; resultCode=[int]$entry.ResultCode; hresult=$entry.HResult; rebootRequired=$entry.RebootRequired }
        })
        $result = @{ resultCode=[int]$installation.ResultCode; hresult=$installation.HResult; updates=$results; rebootRequired=([bool]$installation.RebootRequired -or (Is-RebootPending)); servicesBefore=$serviceBackup }
        if ([int]$installation.ResultCode -eq 2 -and @($results | Where-Object { $_.resultCode -ne 2 }).Count -eq 0) { Save-State 'completed' $result } else { Save-State 'failed' $result }
      }
    }
  }
} catch {
  $state | Add-Member -NotePropertyName error -NotePropertyValue $_.Exception.Message -Force
  Save-State 'failed'
} finally {
  if ($serviceBackup.Count -gt 0) { Restore-Services $serviceBackup }
  if ($null -ne $lock) { $lock.Dispose() }
}
