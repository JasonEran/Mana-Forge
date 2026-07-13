<#
Compatibility entry point for existing shortcuts.
The shared Node configuration loader reads the repository-root .env, and the
foreground supervisor owns readiness, restart, and shutdown for the backend.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir
try {
    & npm start -- @args
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
