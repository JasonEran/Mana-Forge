# Runtime Boundary Threat Model

## Scope

This model covers the supported Windows path: `windows-launcher` -> `node-bot`
-> local Whisper, Llama, and Kokoro processes. It covers local HTTP/WebSocket
traffic, optional mobile exposure, screen and audio data, administrative
mutations, reverse tunnels, and supervised child processes.

Public multi-user hosting is unsupported. The archived `wsl-bot` and `win-bot`
paths are outside this boundary.

## Assets And Trust Zones

| Asset or boundary | Primary risk | Current control |
| --- | --- | --- |
| Core assistant and admin API | LAN or tunneled mutation, data extraction, process control | Loopback bind by default; remote guard denies non-mobile routes |
| Mobile chat and memory | Stolen passcode/session, pairing abuse | PBKDF2 passcode, signed expiring session, rate limit, optional device token, remote admin token |
| Screen captures and OCR text | Disclosure of private windows, credentials, or messages | Core route remains local-only; renderer permission boundary is pending |
| Caption and tray WebSockets | Passive local data capture or notification injection | Loopback clients only, including proxy/tunnel detection |
| Local model and memory files | Read/write by another local process | OS account permissions; no claim of protection from same-user malware |
| Whisper, Llama, Kokoro, and optional children | Orphans, port capture, command/path substitution | Typed configuration, fixed descriptors, supervisor ownership and process-tree cleanup |

## Network Security Invariants

- `node-bot` listens on `127.0.0.1` unless `MANA_BACKEND_HOST` is changed.
- Any non-loopback bind also requires `MANA_ALLOW_REMOTE_ACCESS=1`.
- Remote mode requires a structurally valid PBKDF2 passcode hash and a session
  secret of at least 32 bytes.
- Non-loopback clients and detected reverse proxies can access only `/mobile`.
- A public/non-loopback `Host` or standard forwarding header marks a request as
  remote even when a tunnel connects from loopback.
- Caption and tray WebSockets never accept detected remote clients.
- CORS uses exact origins. Wildcards and origin values containing paths or
  credentials fail configuration validation.
- `MANA_BACKEND_URL` stays loopback so lifecycle health checks never adopt a
  remote backend as a local owned service.

## Threat Scenarios

| Scenario | Disposition |
| --- | --- |
| Another LAN host scans port 5005 | Default listener is unreachable. Explicit LAN mode exposes only `/mobile`. |
| A website calls the loopback API from a browser | No wildcard CORS response is returned. Only the current Electron file origins and explicit exact origins are accepted. |
| A Cloudflare or reverse tunnel targets port 5005 | Proxy/public-host signals force the mobile-only guard; core routes return `403`. |
| A proxy rewrites the host to loopback and strips every forwarding signal | Unsupported and indistinguishable from a local client. Tunnel documentation prohibits this configuration. |
| A remote client calls pairing/device administration | `ADMIN_TOKEN` is required; without it, the request is denied as non-local. |
| A remote client connects to caption or tray WebSockets | Handshake is rejected with `403`. |
| Malicious HTML is loaded inside Electron | High-risk residual until renderer isolation/preload/navigation policy lands in the next Issue #5 slice. |
| Same-user malware calls the loopback API directly | Residual local-host risk; CORS is not an authentication boundary for native processes. Electron isolation and route authentication will reduce, not eliminate, this risk. |
| Screen content contains secrets or prompt injection | Screen routes stay local, but content is untrusted input. Renderer permission/consent and prompt-handling review remain open. |
| A child runtime crashes or leaves descendants | Supervisor restart bounds, stop timeouts, Windows process-tree termination, and port-release checks apply. |

## Current Residual Risk

The Electron launcher still has `nodeIntegration` enabled and
`contextIsolation` disabled. Its renderer can access Node and Electron globals,
and the temporary `file://`/`null` CORS allowance is broader than the final
custom renderer origin should be. Navigation, external-link, window-open,
permission, IPC validation, and screen-capture consent controls are therefore
required before Issue #5 can close.

Local same-user processes remain inside the host trust boundary. Mana does not
claim to resist malware already executing as the user. Direct LAN mode is HTTP;
use a TLS tunnel to prevent bearer-token observation on the network.

## Verification

The backend security gate covers default and explicit binding validation,
credential strength, exact CORS behavior, LAN request filtering, proxy/tunnel
classification, mobile admin enforcement, and WebSocket rejection:

```powershell
node --test node-bot/test/network-security.test.js
```

The next Issue #5 slice must update this document with the final Electron trust
boundary and remove resolved residual risks.
