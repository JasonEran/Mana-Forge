# Archived Runtime Retirement

Status: Accepted on 2026-07-18 under Issue #9.

## Decision

Remove `desktop-client`, `wsl-bot`, and `win-bot` from the current source tree.
Do not copy them into an `archive/` directory. Their source remains available in
Git history, while the supported runtime remains:

```text
windows-launcher -> node-bot -> local Whisper / local Llama / Kokoro
```

The review found no runtime, installer, setup, CI, or licensing dependency that
requires these directories to remain. `windows-native-launcher` is not part of
this retirement and remains experimental under ADR 0001.

## Artifact Disposition

| Artifact | Owner | Unique behavior or evidence | Disposition |
| --- | --- | --- | --- |
| `desktop-client/README.md` | Repository governance | Freeze notice and canonical-runtime pointer | Delete; ADR 0001 and this record replace the notice. |
| `desktop-client/build/installer.nsh` | Desktop runtime | Per-user NSIS autostart selection and uninstall registry cleanup | Delete; the reviewed behavior is owned by `windows-launcher/build/installer.nsh` and was validated under Issue #8. |
| `desktop-client/main.js` | Desktop runtime | Electron window, direct backend spawn/kill, bundled-Node discovery, logs, and broad IPC | Delete; the supported launcher owns the window and uses the shared configuration and `RuntimeSupervisor` contracts. |
| `desktop-client/package.json` | Desktop runtime | Electron 26 / electron-builder 24 build and NSIS resource manifest | Delete; `windows-launcher/package.json` is the only package and installer manifest. |
| `desktop-client/package-lock.json` | Build supply chain | Locked development dependency graph for the frozen package | Delete with its package; none of these dependencies is needed solely by the supported launcher. |
| `desktop-client/preload.js` | Desktop security | Historical backend status, log, error, docs, and animation IPC bridge | Delete; the supported launcher has window-specific, validated preload APIs and security tests. |
| `desktop-client/renderer/index.html` | Desktop runtime | Malformed, superseded prototype UI | Delete; it is not loaded by the historical main process and has no behavior to migrate. |
| `desktop-client/renderer/index_fixed.html` | Desktop runtime | Historical chat, microphone, Doctor, and onboarding layout | Delete; the supported launcher owns those product surfaces. |
| `desktop-client/renderer/renderer.js` | Desktop runtime | Browser audio capture, `/transcribe` and `/synthesize` calls, and status animation | Delete; equivalent supported behavior is owned and tested in `windows-launcher`. |
| `desktop-client/renderer/style.css` | Desktop runtime | Historical shell and CSS-only status indicator | Delete; the shell was intentionally not migrated, and the supported launcher uses the procedural Mana ring. |
| `wsl-bot/README.md` | Assistant runtime | WSL setup for faster-whisper, text-generation-webui, and Coqui TTS | Delete; it describes an unsupported process topology and dependency stack. |
| `wsl-bot/requirements.txt` | Assistant runtime | Pinned Python voice-bridge dependencies | Delete; no supported install consumes this dependency set. |
| `wsl-bot/start.sh` | Assistant runtime | Creates a WSL venv and backgrounds unowned model and API processes | Delete; the supported Windows supervisor owns child readiness, shutdown, ports, and logs. |
| `wsl-bot/voice_bridge.py` | Assistant runtime | FastAPI transcription/model/TTS bridge using faster-whisper and Coqui | Delete; `node-bot`, whisper.cpp, llama.cpp, and Kokoro own the supported equivalents. |
| `win-bot/README.md` | Assistant runtime | Native-Python Windows setup layered on `wsl-bot` | Delete; the canonical Windows quick start replaces it. |
| `win-bot/start.ps1` | Assistant runtime | Native venv and background process launcher for the WSL bridge code | Delete; it has no independent service implementation and is replaced by `windows-launcher` plus `RuntimeSupervisor`. |

No unique artifact is retained in another source directory merely for
reference. Useful behavior is either already owned by the canonical runtime or
is intentionally dropped as an unsupported implementation.

## Licensing And Attribution

- The retired tree contains no separate license, notice, vendored source,
  binary, model weight, or artwork file.
- `desktop-client/package.json` declares Apache-2.0 for repository code. Its
  lockfile records third-party package licenses, but those development
  dependencies and their build output are retired rather than redistributed.
- `wsl-bot/requirements.txt` names external Python packages but vendors none of
  their code or models. Removing an unused dependency list creates no ongoing
  redistribution obligation.
- The repository-level `LICENSE`, `NOTICE`, `THIRD_PARTY.md`, and historical
  `CHANGELOG.md` remain. Historical release facts are not rewritten.

## User Migration

Current development and packaging use `windows-launcher`; there is no data
schema or user-data migration from the retired clients. A source user should
install backend dependencies in `node-bot`, install launcher dependencies in
`windows-launcher`, and start the latter. See the root README and Windows quick
start for the current commands.

Users of the old WSL/native Python bridge must configure the repository-root
runtime settings and local whisper.cpp, llama.cpp, and Kokoro paths. The
retired faster-whisper, text-generation-webui, and Coqui process topology is not
supported by the v0.3 launcher.

## Repository Impact

At the review base (`e74bb5a`), the retirement removes 16 tracked files and
187,410 bytes (183.0 KiB) from a checkout:

| Path | Files | Tracked bytes |
| --- | ---: | ---: |
| `desktop-client` | 10 | 170,186 |
| `wsl-bot` | 4 | 12,428 |
| `win-bot` | 2 | 4,796 |

The review machine also held ignored `desktop-client/dist` and
`desktop-client/node_modules` output. Removing the retired local directory
reclaims approximately 476.7 MiB on that machine, including 293.8 MiB of build
output and 182.7 MiB of dependencies. These generated files were never part of
the Git change.

Git history is intentionally unchanged, so existing object databases do not
shrink and old commits remain auditable. A history rewrite is neither required
nor justified for this maintenance retirement.

## Rollback

The preferred rollback is to revert the Issue #9 merge commit, which restores
source and its documentation/test boundaries together. Before that merge is
known, the three source directories can be inspected or restored from the
review base with:

```powershell
git restore --source=e74bb5a -- desktop-client wsl-bot win-bot
```

Restoration does not make a path supported. Reintroducing a release or runtime
entry point also requires a new ADR, current dependency/security review, and
the same CI and packaging gates as the canonical launcher.
