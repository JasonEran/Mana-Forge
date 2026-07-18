# ADR 0001: One Supported Windows Runtime

- Status: Accepted
- Date: 2026-07-13
- Decision owner: Mana maintainers
- Related: GitHub issue #2, `v0.3 - One Runtime Foundation`

## Context

Mana currently contains multiple overlapping launch and delivery paths. They
have different configuration loading, process ownership, package layouts, and
feature coverage. Treating all of them as current makes setup, support,
security reviews, testing, and releases ambiguous.

The repository's verified local development flow is the Electron launcher with
the Node backend. It provides microphone capture, screen capture, the avatar
overlay, Doctor UI, the local API, Whisper transcription, llama.cpp replies,
and local TTS integration. The other paths are either packaging experiments,
native prototypes, or earlier Python experiments.

## Decision

Mana has one supported product runtime for v0.3:

```text
windows-launcher -> node-bot -> Whisper / llama.cpp / Kokoro
```

`windows-launcher` is the supported Windows desktop shell and development
entry point. `node-bot` is the supported local backend. `tools/` holds
user-installed local inference binaries and models. `tts-service` provides the
supported local TTS service; Kokoro is the default v0.3 provider, while other
providers are optional capabilities.

The supported developer command remains:

```powershell
cd node-bot
npm install

cd ..\windows-launcher
npm install
npm run start
```

No other directory is a supported application entry point or release target
until a later ADR explicitly changes this decision.

## Runtime Lifecycle Matrix

| Area | Lifecycle | Owner | v0.3 policy |
| --- | --- | --- | --- |
| `windows-launcher` | Supported | Desktop runtime | Canonical shell, development entry point, and NSIS installer owner. |
| `node-bot` | Supported | Assistant runtime | Canonical local API and assistant core. |
| `tts-service` | Supported component | Speech runtime | Kokoro is the default provider; other providers are opt-in. |
| `tools/` | Supported support asset | Runtime tooling | Holds locally installed binaries, models, and setup helpers; model weights remain untracked. |
| `desktop-client` | Retired and removed | Repository history | Packaging migrated to `windows-launcher`; the reviewed source is available only from Git history. |
| `windows-native-launcher` | Experimental | Desktop runtime | Prototype only. It must not receive parity work or become a release target without a new ADR. |
| `wsl-bot` | Retired and removed | Repository history | Superseded Python/WSL experiment; available only from Git history. |
| `win-bot` | Retired and removed | Repository history | Superseded native-Python launcher; available only from Git history. |
| `zed-agent` | Optional integration | Assistant runtime | Not part of the default desktop runtime; enabled only through its explicit setup. |

## Consequences

- Documentation, CI, release work, and support requests target the canonical
  path only.
- New desktop features land in `windows-launcher` and `node-bot`; they are not
  duplicated in frozen, experimental, or archived paths.
- Packaging work moves from `desktop-client` to `windows-launcher` rather than
  maintaining two Electron products.
- Runtime/configuration work in issue #3 must serve this path first.
- Optional integrations remain available only when explicitly enabled; they do
  not redefine the core runtime.

## Migration and Deprecation Plan

1. Completed in the v0.3 decision phase: froze `desktop-client` and archived
   `wsl-bot` and `win-bot` before migration and dependency review.
2. Completed in v0.3: installer and bundled-Node ownership migrated from
   `desktop-client` into the canonical launcher under issues #3 and #8.
3. Completed under Issue #9: reviewed every artifact, licensing/attribution
   requirement, user migration, rollback path, and repository-size impact in
   `docs/architecture/archived-runtime-retirement.md`.
4. Completed under Issue #9: removed the three superseded source directories
   and added a boundary test preventing active CI, setup, or packaging paths
   from depending on them.

## Alternatives Considered

### Make `desktop-client` the supported path now

Rejected. It has the installer configuration but duplicates the launcher,
uses a temporary avatar model, has no test suite, and its runtime behavior has
not reached feature parity with `windows-launcher`.

### Make `windows-native-launcher` the supported path now

Rejected. It is a promising low-memory prototype, but it lacks microphone
capture, reply playback, wake/session behavior, and avatar parity.

### Keep all paths supported

Rejected. It preserves ambiguity and multiplies configuration, security,
testing, packaging, and maintenance costs without delivering user value.

### Delete all non-canonical paths immediately

Rejected. Some paths contain reusable installer or prototype work. Their
retirement needs an explicit archive review and migration evidence.

## Rollback Trigger

Reconsider this decision only if the canonical path cannot provide a working
Windows local text, STT, LLM, and TTS loop after issue #3's runtime work, or if
a critical platform/security blocker makes Electron unsuitable. A rollback
requires a new ADR naming a replacement path, its missing parity work, its
configuration contract, and its release evidence. Reopening a second path
without that ADR is not permitted.

## Verification

- The root README and Windows quick start name only the canonical supported
  startup path.
- Build and contribution documentation label non-canonical launchers correctly.
- Repository tests remain green for unchanged code; documentation link checks
  find no primary setup instruction that starts `desktop-client`, `wsl-bot`, or
  `win-bot`.
