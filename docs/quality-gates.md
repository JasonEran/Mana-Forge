# Quality and Release Gates

Mana uses one required workflow, `.github/workflows/ci.yml`, for the supported
Windows runtime. Duplicate fast/full workflows are intentionally prohibited so
branch protection receives one stable signal per responsibility.

## Required PR Checks

| Check | Platform | Contract |
| --- | --- | --- |
| `Backend full suite` | Ubuntu | Clean `npm ci`, every `node-bot/test/*.test.js` file, production dependency audit |
| `Launcher suite` | Ubuntu | Clean `npm ci`, every launcher test, complete launcher dependency audit |
| `Windows lifecycle and package` | Windows | Real backend lifecycle, Electron isolation, canonical NSIS build, ASAR/runtime/model boundary, clean install/Doctor/uninstall smoke, resource budgets |
| `dco` | Ubuntu | Commit sign-off or the repository's accepted contribution agreement path |

The Windows job uploads `windows-quality-evidence` for 30 days and the unsigned
`mana-windows-installer` CI artifact for 14 days. Lifecycle, package, and
installer JSON are machine-produced evidence, not hand-written reports.

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
performance. The complete Core/Full comparison remains the product-profile
measurement owned by Issue #6.

## Branch Protection

Protect `main` against direct pushes and require these exact checks after this
workflow lands:

- `Backend full suite`
- `Launcher suite`
- `Pull request contract`
- `Windows lifecycle and package`
- `dco`

Require branches to be up to date and at least one approving review when a
second maintainer is available. Administrators should not bypass failing
quality checks for a release; use a documented revert or follow-up PR instead.
