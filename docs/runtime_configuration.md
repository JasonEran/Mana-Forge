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
- The backend listens on `127.0.0.1` only.
- Remote/mobile gateway mode is disabled.
- CORS does not accept wildcard origins.
- Kokoro is the default TTS provider.
- Local service URLs use loopback addresses.

Configuration diagnostics must use the shared redaction behavior. Names that
look like API keys, tokens, secrets, passcodes, passwords, or private keys are
never emitted with their values.

## Remote And Mobile Boundary

`MANA_BACKEND_URL` remains the loopback URL used by the launcher, Doctor, and
supervisor for health checks. `MANA_BACKEND_HOST` controls the Node listener and
defaults to `127.0.0.1`; do not change `MANA_BACKEND_URL` to a LAN or public URL.

Remote access has two deliberate modes:

1. A local reverse tunnel keeps `MANA_BACKEND_HOST=127.0.0.1` and sets
   `MANA_ALLOW_REMOTE_ACCESS=1`.
2. Direct LAN listening sets `MANA_BACKEND_HOST=0.0.0.0` (or another explicit
   non-loopback IP) and `MANA_ALLOW_REMOTE_ACCESS=1`.

Both modes require a valid `MOBILE_PASSCODE_HASH` using at least 120,000 PBKDF2
iterations and a `MOBILE_SESSION_SECRET` containing at least 32 bytes. Startup
fails before listening if these requirements are not met. Generate them from
`node-bot`:

```powershell
node -e "const { hashPasscode } = require('./mobile-auth'); console.log(hashPasscode('replace-this-passcode'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

LAN clients and detected proxy/tunnel requests can reach only `/mobile`. Core,
admin, caption WebSocket, and tray WebSocket surfaces remain local-only.
Forwarding headers and a non-loopback `Host` value are treated as remote even
when the proxy connects from `127.0.0.1`. Remote mobile pairing and device
administration also require `ADMIN_TOKEN`; ordinary mobile chat uses the
passcode-derived signed session.

`MANA_CORS_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP or HTTPS
origins. Wildcards, paths, credentials, queries, and fragments are rejected.
The supported Electron file renderer origins (`file://` and `null`) are included
for the current launcher migration. Same-origin `/mobile/app/` deployments do
not need an additional CORS origin.

Direct LAN mode uses plain HTTP and does not protect bearer tokens from network
observers. Prefer an authenticated TLS tunnel and keep host firewall rules
enabled. See [the runtime boundary threat model](security/runtime-boundary-threat-model.md)
and [the mobile tunnel guide](mobile_pwa_cloudflare.md).

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

Every process started by the Windows launcher is described and owned by the
runtime supervisor. Backend and default Kokoro are required; alternate TTS,
retriever, and search descriptors are optional and preserve their existing
enablement conditions until issue #6 changes capability policy.

Doctor builds the same backend and Kokoro descriptors before probing health or
ports. Its `runtime-config` check exposes only service ids, required status,
normalized health URLs, and lifecycle timeouts; child commands and environment
values are not included. Invalid descriptor settings fail this check with fixed,
secret-safe messages instead of crashing Doctor or probing a different target.
