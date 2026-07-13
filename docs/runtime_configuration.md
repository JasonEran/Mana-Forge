# Runtime Configuration

Mana uses one configuration contract for the supported Windows runtime.

## Precedence

Values are resolved in this order:

1. Process environment variables supplied by the user, service manager, or CI.
2. `.env` at the repository root (or `MANA_CONFIG_FILE` when explicitly set).
3. Local runtime discovery under `tools/` for Llama and Whisper paths.
4. Safe local defaults defined in `runtime/config.js`.

Lower-priority sources never overwrite a higher-priority value. The launcher,
backend, and Doctor load this contract before reading runtime settings.

## First-Time Setup

Copy the sample once, then edit only the values that need an override:

```powershell
Copy-Item .env.sample .env
```

`.env` is ignored by Git. Do not put secrets in `.env.sample`, documentation,
logs, screenshots, issue comments, or test fixtures.

The setup script migrates an existing `node-bot/.env` to the root when no root
file exists. The legacy location is not read at runtime.

## Automatic Discovery

When explicit paths are absent, Mana searches:

- `tools/llama/` for the newest versioned `llama-cli` and matching
  `llama-server`;
- `tools/llama/` for preferred local GGUF chat models;
- `tools/whisper/` for `whisper-cli` and a preferred local Whisper model.

This means upgrading from a directory such as `llama-b9436-*` to
`llama-b9984-*` does not require a source-code change. Set `LLAMA_BIN`,
`LLAMA_SERVER_BIN`, `LLAMA_MODEL`, `WHISPER_BIN`, or `WHISPER_MODEL` only when
you intentionally need to override discovery.

## Safe Defaults

- Remote AI is disabled.
- Kokoro is the default TTS provider.
- Local service URLs use loopback addresses.

Configuration diagnostics must use the shared redaction behavior. Names that
look like API keys, tokens, secrets, passcodes, passwords, or private keys are
never emitted with their values.

## Scope

This is the first delivery slice of issue #3. Process readiness, restart,
backoff, log ownership, and Windows process-tree cleanup remain runtime
supervisor work; they should consume this configuration module rather than
introducing another source.
