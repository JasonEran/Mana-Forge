<#
Start Mana local stack (retriever + node) with .env support.
Creates separate windows for retriever and node so you can see logs.
Usage: powershell -ExecutionPolicy Bypass -File start_mana.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir

# Load the repository-root .env without overriding the calling environment.
$envFile = Join-Path $scriptDir "..\.env"
if (Test-Path $envFile) {
    Write-Host "Loading environment from $envFile"
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line -split '=', 2
            if ($parts.Count -eq 2) {
                $name = $parts[0].Trim()
                $value = $parts[1].Trim().Trim('"')
                $existing = [Environment]::GetEnvironmentVariable($name, "Process")
                if ($null -eq $existing) {
                    [Environment]::SetEnvironmentVariable($name, $value, "Process")
                    $display = if ($name -match 'API_KEY|TOKEN|SECRET|PASSCODE|PASSWORD|PRIVATE_KEY') { '[redacted]' } else { $value }
                    Write-Host "  $name=$display"
                } else {
                    Write-Host "  $name already set by process environment"
                }
            }
        }
    }
} else {
    Write-Host ".env not found at $envFile - proceeding with shell environment"
}

# Resolve python from project venv or PATH
$projectVenv = Join-Path $scriptDir "..\ManaAIManatext-generation-webui\venv\Scripts\python.exe"
if (Test-Path $projectVenv) {
    $python = (Resolve-Path $projectVenv).Path
    Write-Host "Using project venv python at $python"
} else {
    $python = "python"
    Write-Host "Using python from PATH"
}

$retrieverScript = Join-Path $scriptDir "..\tools\retriever_service.py"
if (-not (Test-Path $retrieverScript)) {
    Write-Error "Retriever script not found at $retrieverScript"
    Pop-Location
    exit 2
}

# Start retriever in new window
Write-Host "Starting retriever service..."
$retrieverProc = Start-Process -FilePath $python -ArgumentList ('-u', $retrieverScript) -WindowStyle Normal -PassThru
Write-Host "Retriever PID: $($retrieverProc.Id)"

# helper: poll URL
function Wait-ForUrl($url, $retries, $delayMs, $name) {
    for ($i = 1; $i -le $retries; $i++) {
        try {
            $r = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec 5 -ErrorAction Stop
            if ($r -and $r.status -eq 'healthy') {
                Write-Host "[$name] healthy: $($r.details)"
                return $true
            } else {
                Write-Host "[$name] not ready (status=$($r.status)) - attempt $i/$retries"
            }
        } catch {
            Write-Host "[$name] health check attempt $i/${retries}: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds $delayMs
    }
    return $false
}

$retrieverHealthUrl = if ($env:RETRIEVER_HEALTH_URL) { $env:RETRIEVER_HEALTH_URL } else { 'http://127.0.0.1:9000/health' }
$retries = if ($env:RETRIEVER_HEALTH_RETRIES) { [int]$env:RETRIEVER_HEALTH_RETRIES } else { 60 }
$delayMs = if ($env:RETRIEVER_HEALTH_DELAY_MS) { [int]$env:RETRIEVER_HEALTH_DELAY_MS } else { 2000 }
Write-Host "Waiting for retriever health at $retrieverHealthUrl (retries=$retries, delayMs=$delayMs)"
$ok = Wait-ForUrl $retrieverHealthUrl $retries $delayMs 'Retriever'
if (-not $ok) {
    Write-Error "Retriever failed to become healthy in time. See retriever logs."
    Pop-Location
    exit 3
}

# Start Node server in new window
Write-Host "Starting Node backend..."
$nodeExe = "node"
$nodeScript = Join-Path $scriptDir 'server.js'
$nodeProc = Start-Process -FilePath $nodeExe -ArgumentList $nodeScript -WorkingDirectory $scriptDir -WindowStyle Normal -PassThru
Write-Host "Node PID: $($nodeProc.Id)"

# Wait for Node health
$nodeHealthUrl = 'http://127.0.0.1:5005/health'
$nodeRetries = if ($env:NODE_HEALTH_RETRIES) { [int]$env:NODE_HEALTH_RETRIES } else { 30 }
$nodeDelayMs = if ($env:NODE_HEALTH_DELAY_MS) { [int]$env:NODE_HEALTH_DELAY_MS } else { 1000 }
$okNode = Wait-ForUrl $nodeHealthUrl $nodeRetries $nodeDelayMs 'Node'
if (-not $okNode) {
    Write-Error "Node failed to become healthy in time. Check Node logs."
    Pop-Location
    exit 4
}

Write-Host "Mana stack started successfully. Retriever PID=$($retrieverProc.Id), Node PID=$($nodeProc.Id)"
Write-Host "Close this window to leave services running in their own windows."

Pop-Location
