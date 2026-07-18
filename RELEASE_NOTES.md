Developer Preview - Mana v0.2.0

> Archived release note: the third-party testing avatar described below was
> removed from the current source tree. Current builds use the original
> procedural Mana ring and do not accept the old model or artwork assets.

Label: Developer Preview

SHA256 (Mana Setup 0.2.0.exe): 30c214af9520f6f3273a0aa8e6c8cc1d73859596417922e916937f9c6943cbc5

Short install & test instructions

1) Standalone installer (recommended)
   - Download "Mana Setup 0.2.0.exe" from this release's assets.
   - Verify the SHA256 checksum above matches the downloaded file, then run
     the installer on a Windows 10/11 machine.
   - Launch Mana from the Start menu or Desktop shortcut. This build bundles
     a Node runtime and should start the local backend automatically without
     requiring Node.js on the target machine.

2) Current source setup (if not using the historical standalone installer)
   - Install Node.js 22.12 or newer and ensure `node` is on PATH.
   - From the repo: `cd node-bot && npm ci` then
     `cd ../windows-launcher && npm ci`.
   - From `windows-launcher`, start the app with `npm run start`.
   - Or `tools\setup-mana.ps1` automates supported-runtime dependencies,
     `.env` scaffolding, and a Doctor report.

Quick smoke test

- On app start, confirm the status indicator shows the backend is running.
- Press "Hold to Talk" and speak a short phrase.
- Verify transcript appears and a reply is generated. If a reply is
  returned, TTS should play.

What's new since v0.1.0-beta

- Historical model-avatar experiment with lip sync and emotion reactions.
  This implementation has been removed from the current source tree.
- Silence-based voice endpointing, multilingual TTS with per-language voice
  profiles, and spoken-text normalization for emoji/kaomoji/interjections.
- GPT-SoVITS wired as an opt-in trial voice-cloning provider.
- Self-hosted web search/wiki/page-reading via a local SearXNG instance.
- Persistent llama-server runtime (replacing spawn-per-request calls) and
  hourly, hash-skipping background memory indexing.
- Local vision support (screen/image description via a local Qwen2.5-VL
  model).
- Relicensed the code from PolyForm Noncommercial to Apache License 2.0.
- A setup automation script (`tools\setup-mana.ps1`) for first-run npm
  installs, `.env` scaffolding, and a doctor report.

Full detail: see CHANGELOG.md's [0.2.0] entry.

Avatar notice

The historical testing avatar is not part of the current repository and must
not be restored or redistributed. Mana now uses a code-rendered activity ring.

Known issues & caveats

- Developer Preview: this is an early release for developers and testers.
  Expect rough edges and manual setup steps for models/binaries not
  bundled in the installer.
- Code signing: the installer is unsigned. Unsigned installers may trigger
  Windows SmartScreen warnings — this is expected for a preview build.
- Models & large binaries: this repo/installer does not include model
  weights (LLAMA, GGUF, whisper models) or some native bindings. Download
  those separately as documented in THIRD_PARTY.md and BUILD_DESKTOP.md.
- Antivirus / SmartScreen: some AV/SmartScreen products may flag unsigned
  installers or executables — expected for preview builds.
- Artwork: current source builds do not require or load avatar artwork or
  character models.
- FAISS/native bindings: if FAISS or other native bindings are not present
  on the target, the server falls back to JS/JSON adapters (functional but
  slower).

Contact / Feedback

- Report issues on GitHub Issues (use the "Contribution request" template
  for contribution proposals).
- For CLA or contributor inquiries, contact: yuuzulight@gmail.com
