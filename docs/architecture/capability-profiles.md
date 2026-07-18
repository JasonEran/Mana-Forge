# Capability profiles

Mana starts in the **Core** profile. Optional capabilities are absent unless a
single capability flag is set to `1`, or the operator explicitly selects the
**Full** profile with `MANA_PROFILE=full`.

The machine-readable source of truth is
`node-bot/capabilities/manifest.js`. It owns profile membership, enablement,
ownership, dependencies, processes, ports, health, and uninstall behavior.

## Install contracts

Core installs only the backend packages required by the supported desktop
assistant:

```powershell
cd node-bot
npm ci --omit=optional
$env:MANA_PROFILE = "core"
```

Full installs optional Node packages and explicitly enables every capability:

```powershell
cd node-bot
npm ci
$env:MANA_PROFILE = "full"
```

For a smaller custom profile, leave `MANA_PROFILE=core`, run the Full dependency
install only when the selected capability needs it, and set the individual
`MANA_*_ENABLED=1` flags below.

## Core inventory

| Capability | Owner | Runtime dependencies | Processes | Ports / health |
| --- | --- | --- | --- | --- |
| Electron desktop shell | Desktop Runtime | `windows-launcher`, `ws` | `electron` | Caption and tray WebSockets share the backend listener |
| Local API and text chat | Backend Runtime | `express`, `cors`, `multer`, Node | `node-bot` | `127.0.0.1:5005`, `GET /health` |
| Whisper STT | Speech Runtime | whisper.cpp binary and model | `whisper-cli` on demand | No port; Doctor validates binary and model |
| llama.cpp | Local AI Runtime | llama.cpp binary and text GGUF | `llama-server` or `llama-cli` | Configured loopback endpoint; Doctor and `/health` |
| Kokoro TTS | Speech Runtime | Kokoro service runtime | `kokoro-service` | `127.0.0.1:5011`, `/health` |

The clean Node package set is `express`, `cors`, `multer`, and `ws`. Model,
speech, and TTS binaries are first-run runtime assets and are not npm packages.

## Optional inventory

| Capability / flag | Owner | Dependencies and processes | Health | Disable / uninstall behavior |
| --- | --- | --- | --- | --- |
| Vision/OCR `MANA_VISION_ENABLED` | Local AI Runtime | Optional `tesseract.js`, vision GGUF/projector; Tesseract and vision inference only on demand | Doctor model/dependency check; `/health` state | Routes are absent, OCR is not imported, no cache or worker is created; run Core install and remove vision assets |
| Retrieval `MANA_RETRIEVAL_ENABLED` | Knowledge Runtime | Python retriever/vector runtime; optional `retriever-service` on port 9000 | Retriever `/health` | No service plan, startup probe, reply retrieval, process, timer, or warning; remove venv/vector store |
| Web/SearXNG `MANA_WEB_ACCESS_ENABLED` | Knowledge Runtime | SearXNG and network access; optional process on port 8890 | SearXNG HTTP probe only while enabled | No route, service plan, or probe; remove `tools/searxng` |
| Stock market `MANA_STOCK_MARKET_ENABLED` | Integrations | Provider credentials and network access | Provider configuration in `/health` | No routes or provider client; remove credentials |
| FFXIV market `MANA_FFXIV_MARKET_ENABLED` | Integrations | Universalis/XIVAPI network access | Provider configuration in `/health` | No routes and the large market module is not imported |
| VTube Studio `MANA_VTUBE_STUDIO_ENABLED` | Desktop Integrations | `ws`, user-managed VTube Studio on port 8001 | Configured/connection state | No client, reactions, route, socket, or probe |
| Alternate TTS `MANA_ALTERNATE_TTS_ENABLED` | Speech Runtime | Selected Chatterbox, Fish, CLI, or GPT-SoVITS runtime | Selected provider probe | Launcher stays on Kokoro; remove the alternate provider runtime |
| Mobile `MANA_MOBILE_ENABLED` | Client Integrations | Auth secrets and optional tunnel | Auth/storage state in `/health` | No routes, pairing store, memory store, tunnel probe, or files |
| Editor/ACP `MANA_EDITOR_ACP_ENABLED` | Developer Integrations | Optional `axios`, editor registration, ACP agent on demand | Doctor editor/agent checks | No editor routes, ACP store, backend probe, or agent process; remove editor registration and run Core install |
| Directory scanner `MANA_DIR_SCANNER_ENABLED` | Developer Integrations | No external package | Route state in `/health` | Route and module are absent |
| Background memory `MANA_BACKGROUND_MEMORY_ENABLED` | Knowledge Runtime | ACP session storage | Timer count/job results | No storage load, audit build, scheduled job, or timer; remove memory data if unneeded |
| Reply verification `MANA_REPLY_VERIFICATION_ENABLED` | Developer Integrations | Optional `esprima` and Python token-worker pool | Dependency availability | Verifier and Python workers are not imported or started; run Core install |

## Health states

- `disabled`: capability was not enabled; Doctor treats this as a clean pass and
  performs no probe.
- `configured`: enabled and configuration is present, but no live dependency has
  been proven yet.
- `available`: enabled and the local implementation or health probe is ready.
- `degraded`: enabled, but configuration, dependency, or health is incomplete.

Disabled capabilities must not produce warning noise. A warning is reserved for
an explicitly enabled capability that cannot satisfy its contract.

## Measurement evidence

Run `npm run measure:profiles` in `node-bot` to regenerate
`quality/capability-profiles.json`. The probe creates isolated Core and Full
installs, starts each backend on one temporary loopback port, records cold
start, RSS, VRAM, active resources, warnings, loaded optional modules, and then
closes the listener and deletes temporary data.

The 2026-07-18 Windows snapshot reports:

| Metric | Core | Full | Delta |
| --- | ---: | ---: | ---: |
| Node dependency disk | 2.8 MiB | 54.5 MiB | +51.7 MiB |
| Backend cold start | 153 ms | 541 ms | +388 ms |
| Backend RSS | 65.1 MiB | 64.5 MiB | -0.6 MiB (sampling noise) |
| Actual backend processes | 1 | 1 | 0 |
| Launcher-planned services | backend, Kokoro | backend, Kokoro, Retriever | +Retriever |
| Backend VRAM | 0 MiB | 0 MiB | 0 MiB |
| Scheduled timeout resources | 0 | 2 | +2 |
| Warning count | 0 | 0 | 0 |

This backend probe intentionally does not load llama, Whisper, or TTS models.
The complementary target-machine run in `quality/core-release-evidence.json`
loads the complete Electron/backend/llama.cpp/Whisper/Kokoro process tree and
checks every process, RAM, VRAM, startup, text, STT, and TTS limit in
`quality/budgets.json`. See `docs/quality-gates.md` for the command and results.

## Runtime retirement

ADR 0001 remains authoritative for abandoned runtime paths:

- `windows-launcher`, `node-bot`, `runtime`, `tools/llama`, `tools/whisper`, and
  `tts-service` are the supported product path.
- `desktop-client`, `wsl-bot`, and `win-bot` were reviewed and removed under
  Issue #9. Their source remains in Git history; the artifact, license,
  migration, size, and rollback decisions are recorded in
  `docs/architecture/archived-runtime-retirement.md`.
- `windows-native-launcher` remains experimental and cannot become a release
  target without a new ADR.
- Boundary tests keep retired paths out of current CI, setup, and packaging
  inputs. No historical asset may be migrated into the supported runtime
  without provenance and license review.
