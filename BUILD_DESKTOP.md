# Windows Packaging

`windows-launcher` is the only supported Windows installer owner. The frozen
`desktop-client` directory is not built or published.

## Migration Inventory

| Historical behavior | Canonical disposition |
| --- | --- |
| Per-user NSIS with selectable install directory | Retained in `windows-launcher/build/installer.nsh` and package metadata |
| Optional start-at-login registry value | Retained; uninstall removes the value |
| Bundled `node.exe` resource | Retained as `resources/node_bin/node.exe` with explicit runtime resolution |
| Backend copied beside Electron resources | Retained with production dependencies and the shared `runtime/` contract |
| Direct `spawn()`/`kill()` lifecycle in `desktop-client` | Dropped; packaged and development launches both use `RuntimeSupervisor` |
| Bundled model weights | Rejected; models remain first-run/unbundled assets |
| Frozen renderer/avatar implementation | Not migrated; `windows-launcher` remains the sole product shell |

## Local Build

On Windows 10/11 with Node.js 22.12 or newer:

```powershell
cd C:\ManaAI\Mana
powershell -ExecutionPolicy Bypass -File .\scripts\fetch_node_bin.ps1 `
  -Version 22.12.0 -Arch x64
cd node-bot
npm ci
cd ..\windows-launcher
npm ci
npm run dist
npm run verify:package
npm run verify:installer
```

The NSIS artifact is written to `windows-launcher/dist/Mana-Setup-<version>-x64.exe`.
The installer is per-user, supports a custom installation directory, and
removes its autostart registry value during uninstall.

## Bundled Node

The package accepts an optional official Node distribution staged at the
repository root as `node-bin/node.exe`. `windows-launcher` copies it into the
installer as `resources/node_bin/node.exe` and prefers it for the supervised
backend. Development falls back to the configured system `node` command.

Do not commit `node-bin`; verify the upstream Node redistribution terms before
publishing a release. The CI package gate stages the runner's Node executable
only to validate the resource boundary.

## First Run

Model weights are deliberately not bundled. Install local Whisper/llama.cpp
assets and the Kokoro runtime through the existing setup instructions after
installation. Until those assets exist, the launcher starts the backend and
reports the missing provider state in Doctor; it does not download weights as
part of the installer.

Runtime data is written below Electron's per-user `userData` directory. The
installed resources contain source/runtime files only and are never used as a
database location.

For an isolated install/launch/Doctor/uninstall check:

```powershell
cd C:\ManaAI\Mana
powershell -ExecutionPolicy Bypass -File .\scripts\windows-installer-smoke.ps1 `
  -InstallerPath .\windows-launcher\dist\Mana-Setup-0.2.0-x64.exe
```

The smoke checks installation into a temporary directory, backend `/health`,
Doctor, model status, port release, and removal of the installed executable.
It disables optional provider startup for this model-free proof and writes
machine-readable evidence when `MANA_INSTALLER_EVIDENCE_FILE` is set.

## Rollback

The migration is isolated to `windows-launcher`, runtime resource descriptors,
and packaging docs. Revert the packaging PR and remove its branch-protection
check only if the installer artifact or clean-install evidence regresses; the
development launcher/backend contract remains unchanged.
