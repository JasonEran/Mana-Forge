# Changelog

All notable changes to Mana are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

This file starts tracking from **0.2.0** — Mana has an extensive commit
history before this (`git log` has the full detail), but nothing summarized
it at a release level until now. Earlier work isn't reconstructed
retroactively; `0.1.0` below is a short baseline description, not a full
accounting.

## [Unreleased]

## [0.3.0] - 2026-07-18

### Added

- Declared one supported Windows runtime:
  `windows-launcher -> node-bot -> local Whisper / local Llama / Kokoro`, with
  an accepted ADR and explicit lifecycle states for every competing path.
- Added one configuration contract and one `RuntimeSupervisor` for launcher,
  backend, Doctor, packaged-app discovery, service readiness, restart/backoff,
  logging, port ownership, and process-tree cleanup.
- Added explicit Core and Full capability profiles. Optional integrations no
  longer install, boot, probe, schedule work, reserve ports, or produce warning
  noise unless enabled.
- Added one required Quality gates workflow covering Core and Full backend
  suites, launcher tests, Electron isolation, the canonical NSIS installer,
  clean install/Doctor/uninstall, resource budgets, dependency audits, and
  machine-readable evidence.
- Replaced character artwork with an original procedural Mana identity: 32
  radial bars, white breathing idle motion, pale-green active energy waves,
  audio-reactive pulses, and reduced-motion support. The same dependency-free
  Canvas component now renders both supported Electron surfaces.

### Changed

- Reduced `node-bot/server.js` to an explicit composition root with route
  ownership boundaries and lifecycle-owned background work.
- Moved installer ownership to `windows-launcher`; packaged and development
  launches now consume the same shared configuration and supervisor contracts.
- Made the local llama-server the measured Core reply path while keeping
  remote AI disabled by default and model weights outside the installer.

### Removed

- Removed five PNG avatar files at the rights holder's request, along with
  their crop scripts and all runtime, packaging, and
  documentation references. Tray and status UI fallbacks now use generated or
  CSS-only indicators, and a boundary test prevents the removed assets from
  being added again.
- Removed the remaining PNG/SVG avatar art, model loader and protocol, model
  renderer, fetch/check tools, setup guides, notices, and Pixi/model-runtime
  dependencies. The frozen desktop and native launcher paths no longer read
  avatar files.
- Removed the superseded `desktop-client`, `wsl-bot`, and `win-bot` runtime
  trees after inventorying their behavior, licensing, migration, and rollback
  paths. They remain auditable in Git history but are not supported products.

### Fixed

- Kept persistent Python token-cache workers out of the Core profile, reducing
  the measured complete runtime from 13 processes to 10 instead of weakening
  the 12-process release budget.
- Corrected Windows executable and repository path handling across the shared
  runtime and editor/ACP boundaries.

### Security

- Enforced loopback-only Core services, explicit authenticated remote mode,
  restricted CORS, protected administrative mutations, and secret-safe
  diagnostics.
- Enabled Electron sandboxing and context isolation, disabled renderer Node
  integration, narrowed preload IPC, and enforced navigation, window-open,
  permission, and external-link policies.
- Completed backend and launcher runtime dependency audits with no accepted
  high or critical findings.

### Validation

- Verified a real Windows Core loop with local Whisper, llama.cpp/Qwen3-4B,
  and Kokoro: 10 processes, 3,649.4 MiB RAM, 3,287 MiB dedicated VRAM, 1,739 ms
  cold start, 93 ms warm text, 820 ms STT, and 3,232 ms TTS.
- Verified clean shutdown with ports 5005, 5011, and 8090 released and zero
  descendant processes. The committed target evidence is
  `quality/core-release-evidence.json`.

## [0.2.0] - 2026-07-12

### Added
- **Live2D avatar ported into `desktop-client`** (the installer-packaged
  app): same driver as `windows-launcher`, with emotion-reactive states and
  RMS lip sync wired into the reply/audio flow, plus a zoom control and an
  always-visible in-app disclaimer banner. Clearly marked as a temporary
  testing placeholder, not the final avatar. This historical implementation
  was removed from current source under the Unreleased changes above.
  Required temporarily enabling `nodeIntegration` for the desktop client's
  main window (documented tradeoff, scoped to this feature).
- **Setup automation script** (`tools/setup-mana.ps1`) for first-run npm
  installs across all three subprojects, `.env` scaffolding, model/binary
  directory creation, and a doctor report.
- **Built-in Live2D avatar** (`windows-launcher`): renders a Cubism model
  directly in the desktop UI instead of requiring VTube Studio. Drives
  emotion-appropriate motions/expressions from reply text (including
  kaomoji/emoji, not just English mood words), real-time lip sync, natural
  randomized blinking, a fixed-width zoom control (whole body / waist-up /
  bust-up), and an idle-tilt correction for models whose idle motion pitches
  back sharply. Every tuning knob (mouth gain, eye-open scale, blink/smile/
  brow parameter ids, idle tilt angles, state→motion/expression mapping) is
  configurable per-model via `mana-avatar.json`. This historical implementation
  was removed from current source under the Unreleased changes above.
- **Silence-based voice endpointing**: Mana waits for an actual pause
  (~2.2s, tunable) before treating speech as a finished prompt, instead of
  cutting a long sentence off at a fixed duration.
- **Multilingual TTS**: automatic language detection with per-language
  Kokoro voice profiles (English, Chinese, Japanese, Korean), instead of
  always speaking in English regardless of reply language.
- **Speech text normalization**: emoji/kaomoji become short spoken words
  ("smile", "sniff") instead of long Unicode names being read aloud,
  vowel-less interjections get pronounceable spellings, and a trailing "~"
  stretches the last vowel instead of being narrated as "tilde".
- **GPT-SoVITS** wired as an opt-in trial voice-cloning provider alongside
  Kokoro/Chatterbox/Fish Speech.
- **Self-hosted web access**: search, wiki lookups, and reading a page Mana
  is pointed at, backed by a local, single-user SearXNG instance rather than
  a public instance or third-party search API.
- **Persistent llama-server runtime** with CLI fallback, replacing
  spawn-per-request `llama-cli` calls; background memory-indexing jobs now
  run hourly, skip via content hash when nothing changed, and pause while a
  watched game has focus.
- **Local vision support**: screen/image description via a local
  Qwen2.5-VL model (`POST /vision/describe`, `image` field on `POST /reply`).

### Changed
- **Relicensed from PolyForm Noncommercial 1.0.0 to Apache License 2.0**
  for the code, so GitHub's license picker/badge recognizes it. This
  permits commercial use of the code by others, a deliberate tradeoff for
  recognizability. Third-party assets remained subject to their own terms.

### Fixed
- Closed two real gitignore gaps: personal voice-audition/reference audio
  was only untracked by luck (nothing actually ignored it), and Python
  `__pycache__` bytecode had been committed.

## [0.1.0] - 2026 (baseline)

Initial local-first voice assistant: wake-word listening, local speech
transcription (whisper.cpp), local reply generation (llama.cpp + GGUF
models), local TTS playback (Kokoro/Chatterbox), and the Windows Electron
launcher.
