<#
.SYNOPSIS
  Installs the canonical Mana NSIS artifact, checks first-run readiness, and uninstalls it.

.DESCRIPTION
  This smoke intentionally disables optional TTS/retriever services so a clean
  machine can prove the packaged launcher/backend contract before first-run
  model/provider setup. It never uses the frozen desktop-client path.
#>
[CmdletBinding()]
param(
  [string]$InstallerPath,
  [string]$EvidencePath = $env:MANA_INSTALLER_EVIDENCE_FILE,
  [switch]$KeepArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Log([string]$Message) {
  Write-Host "[installer-smoke] $Message"
}

function Wait-Endpoint([string]$Name, [string]$Uri, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 3
      if ($null -ne $response) {
        Write-Log "$Name ready at $Uri"
        return $response
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)
  throw "$Name did not become ready at $Uri"
}

if (-not $InstallerPath) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $installers = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot "windows-launcher\dist") `
      -Filter "Mana-Setup-*.exe" -File -ErrorAction SilentlyContinue
  )
  if ($installers.Count -ne 1) {
    throw "Expected exactly one canonical installer, found $($installers.Count)."
  }
  $InstallerPath = $installers[0].FullName
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "Installer not found: $InstallerPath"
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$smokeRoot = Join-Path $env:TEMP ("mana-installer-smoke-" + [Guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $smokeRoot "install"
$dataRoot = Join-Path $smokeRoot "user-data"
$appProcess = $null
$oldDataDir = $env:MANA_DATA_DIR
$oldStartKokoro = $env:MANA_START_KOKORO
$oldStartRetriever = $env:MANA_START_RETRIEVER
$oldStartSearxng = $env:MANA_START_SEARXNG
$oldElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE

try {
  New-Item -ItemType Directory -Force -Path $smokeRoot, $installRoot, $dataRoot | Out-Null
  Write-Log "Installing $installer into isolated path $installRoot"
  $installResult = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
  if ($installResult.ExitCode -ne 0) {
    throw "Installer exited with code $($installResult.ExitCode)"
  }

  $appPath = Join-Path $installRoot "Mana.exe"
  if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
    throw "Installed Mana.exe not found at $appPath"
  }
  $bundledNodePath = Join-Path $installRoot "resources\node_bin\node.exe"
  if (-not (Test-Path -LiteralPath $bundledNodePath -PathType Leaf)) {
    throw "Bundled Node runtime not found at $bundledNodePath"
  }
  $uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "*uninstall*.exe" -File | Select-Object -First 1
  if (-not $uninstaller) {
    throw "NSIS uninstaller was not installed under $installRoot"
  }

  $env:MANA_DATA_DIR = $dataRoot
  $env:MANA_START_KOKORO = "0"
  $env:MANA_START_RETRIEVER = "0"
  $env:MANA_START_SEARXNG = "0"
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Write-Log "Launching packaged Mana.exe"
  $appProcess = Start-Process -FilePath $appPath -PassThru

  $health = Wait-Endpoint "backend health" "http://127.0.0.1:5005/health"
  $doctor = Wait-Endpoint "Doctor" "http://127.0.0.1:5005/doctor"
  $models = Wait-Endpoint "model status" "http://127.0.0.1:5005/models/status"
  if (-not $health.ok) {
    throw "Health response did not report ok=true"
  }
  if ($null -eq $doctor.checks) {
    throw "Doctor response did not include checks"
  }

  Write-Log "Stopping packaged process tree"
  & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
  $appProcess = $null
  Start-Sleep -Seconds 3
  $backendListeners = Get-NetTCPConnection -State Listen -LocalPort 5005 -ErrorAction SilentlyContinue
  if ($backendListeners) {
    throw "Backend port 5005 remained occupied after launcher shutdown"
  }

  Write-Log "Uninstalling packaged Mana"
  $uninstallResult = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
  if ($uninstallResult.ExitCode -ne 0) {
    throw "Uninstaller exited with code $($uninstallResult.ExitCode)"
  }
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $appPath) {
    throw "Installed executable remains after uninstall: $appPath"
  }
  if (Test-Path -LiteralPath $uninstaller.FullName) {
    throw "NSIS uninstaller remains after uninstall: $($uninstaller.FullName)"
  }

  $modelSummary = [ordered]@{
    activeProfile = $models.activeProfile
    remoteAiEnabled = [bool]$models.remoteAiEnabled
    availableProfiles = @(
      $models.profiles.PSObject.Properties |
        Where-Object { $_.Value.available } |
        ForEach-Object { $_.Name }
    )
  }

  $evidence = [ordered]@{
    installer = Split-Path -Leaf $installer
    installerBytes = (Get-Item -LiteralPath $installer).Length
    installerMiB = [Math]::Round((Get-Item -LiteralPath $installer).Length / 1MB, 2)
    installPath = $installRoot
    dataPath = $dataRoot
    installExitCode = $installResult.ExitCode
    bundledNode = $true
    health = [bool]$health.ok
    doctorChecks = @($doctor.checks).Count
    modelsStatus = $modelSummary
    backendPortReleased = $true
    uninstallExitCode = $uninstallResult.ExitCode
    uninstallRemovedExecutable = $true
    uninstallRemovedUninstaller = $true
    optionalServicesDisabledForSmoke = $true
  }
  if (-not $EvidencePath) {
    $EvidencePath = Join-Path (Get-Location) "installer-evidence.json"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $EvidencePath) | Out-Null
  $evidenceJson = $evidence | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $EvidencePath,
    $evidenceJson + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
  Write-Log "Installer smoke passed; evidence written to $EvidencePath"
} finally {
  if ($appProcess -and -not $appProcess.HasExited) {
    & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
  }
  if ($null -eq $oldDataDir) { Remove-Item Env:MANA_DATA_DIR -ErrorAction SilentlyContinue } else { $env:MANA_DATA_DIR = $oldDataDir }
  if ($null -eq $oldStartKokoro) { Remove-Item Env:MANA_START_KOKORO -ErrorAction SilentlyContinue } else { $env:MANA_START_KOKORO = $oldStartKokoro }
  if ($null -eq $oldStartRetriever) { Remove-Item Env:MANA_START_RETRIEVER -ErrorAction SilentlyContinue } else { $env:MANA_START_RETRIEVER = $oldStartRetriever }
  if ($null -eq $oldStartSearxng) { Remove-Item Env:MANA_START_SEARXNG -ErrorAction SilentlyContinue } else { $env:MANA_START_SEARXNG = $oldStartSearxng }
  if ($null -eq $oldElectronRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $oldElectronRunAsNode }
  if (-not $KeepArtifacts -and (Test-Path -LiteralPath $smokeRoot)) {
    Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
