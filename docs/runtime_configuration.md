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

## Runtime Supervision

The Windows launcher starts the required backend through the shared runtime
supervisor. `MANA_BACKEND_URL` controls both its readiness endpoint and local
listening port. `MANA_BACKEND_STARTUP_TIMEOUT_MS` controls how long the launcher
waits for `/health` before reporting an actionable startup failure, while
`MANA_BACKEND_SHUTDOWN_TIMEOUT_MS` bounds process and port cleanup.

The supervisor owns backend state and bounded logs, treats repeated starts as
one operation, reports unhealthy port conflicts, restarts unexpected exits with
bounded exponential backoff, and uses Windows process-tree termination on
shutdown. A backend that was already healthy before the launcher started is
left running because the launcher does not own that process.

Electron, `npm start`, `run_node_server.bat`, and existing
`start_mana.ps1` shortcuts all use the same backend descriptor and supervisor.
The command stays in the foreground so Ctrl+C can verify process and port
cleanup before it returns. Use `npm run start:raw` only for low-level backend
debugging where supervision is intentionally bypassed.

The supported backend and default Kokoro TTS provider are supervised services.
Alternate TTS providers, retriever, and search retain their existing lifecycle
until their optional-capability policy is defined in issue #6.
