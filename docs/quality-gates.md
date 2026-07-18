# Quality and Release Gates

Mana uses one required workflow, `.github/workflows/ci.yml`, for the supported
Windows runtime. Duplicate fast/full workflows are intentionally prohibited so
branch protection receives one stable signal per responsibility.

## Required PR Checks

| Check | Platform | Contract |
| --- | --- | --- |
| `Backend full suite` | Ubuntu | Clean `npm ci`, every `node-bot/test/*.test.js` file, production dependency audit |
| `Backend Core profile` | Ubuntu | Core-only dependency install, representative Core suite, release metadata, optional-package absence |
| `Launcher suite` | Ubuntu | Clean `npm ci`, every launcher test, complete launcher dependency audit |
| `Windows lifecycle and package` | Windows | Real backend lifecycle, Electron isolation, canonical NSIS build, ASAR/runtime/model boundary, clean install/Doctor/uninstall smoke, resource budgets |
| `dco` | Ubuntu | Commit sign-off or the repository's accepted contribution agreement path |

The Windows job uploads `windows-quality-evidence` for 30 days and the unsigned
`mana-windows-installer` CI artifact for 14 days. The installer artifact also
contains an ASCII SHA-256 companion bound to the versioned filename. Lifecycle,
package, and installer JSON are machine-produced evidence, not hand-written
reports.

## Release Metadata

`scripts/check-release-metadata.js` is the repository-wide version contract.
It requires launcher/backend manifests and lockfile roots to share one strict
semantic version, requires a matching dated changelog entry, verifies the
version-derived x64 installer name, and rejects a mismatched release tag.

```powershell
node scripts/check-release-metadata.js
$env:MANA_RELEASE_TAG = "v0.3.0"
node scripts/check-release-metadata.js
```

The Core test tier exercises success and failure cases. Quality gates run the
command directly before packaging, and `scripts/write-installer-checksum.js`
reuses the same contract before writing the checksum.

## Test Tiers

The backend runner has explicit tiers and never changes scope based on
`GITHUB_EVENT_NAME` or a pull-request ref:

```powershell
npm run test:core --prefix node-bot
npm run test:full --prefix node-bot
npm run test:optional --prefix node-bot
```

- `core` is a fast representative developer loop covering architecture,
  configuration, API contracts, security, Doctor, and lifecycle ownership.
- `full` discovers and runs every backend test file sequentially and is the PR
  gate.
- `optional` focuses on capability/provider boundaries. It is useful while
  developing an integration, but does not replace `full`.

Sequential files keep peak memory bounded and make the failing owner visible.
Provider tests use local fakes; CI never downloads model weights or contacts a
paid/external model API.

## Windows Lifecycle Smoke

`scripts/windows-lifecycle-smoke.js` reserves an isolated loopback port and
starts the real backend through `RuntimeSupervisor`. It verifies:

1. the backend becomes ready and is supervisor-owned;
2. `/health` reports the backend available;
3. `/models/status` completes through a real local API route;
4. shutdown removes the owned process tree and releases the port.

The job starts from clean `npm ci` installations. The source-runtime smoke is
kept as a focused supervisor baseline, while `windows-installer-smoke.ps1`
installs the canonical NSIS artifact into an isolated location, launches it,
reaches `/health`, `/doctor`, and `/models/status`, releases the backend port,
and verifies uninstall removal.

## Packaging Boundary

The Windows job builds the canonical `windows-launcher` NSIS installer and
parses its actual ASAR and unpacked resources. The gate requires Electron
security/preload files, the shared runtime, backend source and production
dependencies, plus bundled Node. It rejects development assets and model-weight
extensions (`.bin`, `.gguf`, `.onnx`, `.safetensors`, and similar).

The same Windows job captures real Electron frames for the procedural avatar.
The pixel gate requires a nonblank white idle ring and a nonblank pale-green
active ring, and uploads both PNGs with the other quality evidence.

Model/provider assets remain first-run and unbundled. The retired runtime
sources were removed under Issue #9; the launcher suite prevents them from
returning as workflow, setup, packaging, or publication paths.

## Resource Budgets

`quality/budgets.json` is the versioned source of truth.

- `ciLifecycle` is enforced on every PR: one owned backend process, backend
  RSS, cold start, health/local-request latency, ASAR size, and installer size.
- `coreRelease` defines release limits for the complete Core profile: process
  count, idle RAM/VRAM, cold start, warm text, STT, and TTS latency.

CI lifecycle values are model-free and must not be presented as model
performance. A v0.3 release candidate must attach a Core-profile measurement
from the target Windows/GPU configuration for every `coreRelease` field.
Missing values fail release review; unavailable hardware is evidence, not a
numeric zero. Budgets are ceilings, not expected performance targets.

Initial model-free Windows baseline captured on July 17, 2026:

| Metric | Value |
| --- | ---: |
| Supervisor-owned processes | 1 |
| Backend RSS | 79 MB |
| Backend cold start | 1,058 ms |
| Health latency | 4 ms |
| Local model-status request | 2 ms |
| Launcher ASAR | 36.3 MiB |

This baseline proves the gate and starts the CI trend; it does not claim model
performance. The Core/Full dependency and quiet-runtime comparison is owned by
Issue #6.

### Core Release Measurement

Issue #31 adds the target-machine gate for the complete Core runtime. Before a
release candidate, install the launcher/backend dependencies and the local
llama.cpp, Whisper, and Kokoro assets documented by the Windows quick start.
Ensure ports 5005, 5011, and 8090 are free, then run:

```powershell
cd windows-launcher
npm run measure:core-release
```

The command launches the real Electron 43 main and avatar renderers plus the
canonical launcher service plan. It rejects remote AI, provider placeholders,
missing GPU process telemetry, empty Whisper output, invalid WAV output,
unowned services, occupied canonical ports, shutdown residue, and any value
above `coreRelease`. Kokoro generates a deterministic local phrase which is
then transcribed by Whisper; two local LLM requests prove cold model load and
warm text response. No model or generated audio is committed.

Machine-readable evidence is written to
`quality/core-release-evidence.json`. The 2026-07-18 target run used an AMD
Ryzen 7 7800X3D, 31,862 MiB RAM, and an NVIDIA GeForce RTX 5070 Ti with 16,303
MiB VRAM:

| Metric | Measured | Limit |
| --- | ---: | ---: |
| Complete Core process tree | 10 | 12 |
| Idle RAM | 3,649.4 MiB | 4,096 MiB |
| Attributed dedicated VRAM | 3,287 MiB | 6,144 MiB |
| Cold start to renderer/services ready | 1,739 ms | 180,000 ms |
| Warm local text reply | 93 ms | 30,000 ms |
| Local Whisper STT | 820 ms | 15,000 ms |
| Local Kokoro TTS | 3,232 ms | 15,000 ms |

The run transcribed `Mana release validation is ready.` exactly and left zero
owned child processes or test ports. This target evidence complements the
model-free clean-install/Doctor/uninstall proof; it does not make model weights
part of the installer or CI checkout.

## Branch Protection

Protect `main` against direct pushes and require these exact checks after this
workflow lands:

- `Backend full suite`
- `Backend Core profile`
- `Launcher suite`
- `Pull request contract`
- `Windows lifecycle and package`
- `dco`

Require branches to be up to date and at least one approving review when a
second maintainer is available. Administrators should not bypass failing
quality checks for a release; use a documented revert or follow-up PR instead.
