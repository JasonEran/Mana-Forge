# Runtime Boundary Threat Model

## Scope

This model covers the supported Windows path: `windows-launcher` -> `node-bot`
-> local Whisper, Llama, and Kokoro processes. It covers local HTTP/WebSocket
traffic, optional mobile exposure, screen and audio data, administrative
mutations, reverse tunnels, and supervised child processes.

Public multi-user hosting is unsupported. The retired WSL and native-Python
implementations were removed from the current tree and remain outside this
boundary.

## Assets And Trust Zones

| Asset or boundary | Primary risk | Current control |
| --- | --- | --- |
| Core assistant and admin API | LAN or tunneled mutation, data extraction, process control | Loopback bind by default; remote guard denies non-mobile routes |
| Mobile chat and memory | Stolen passcode/session, pairing abuse | PBKDF2 passcode, signed expiring session, rate limit, optional device token, remote admin token |
| Screen captures and OCR text | Disclosure of private windows, credentials, or messages | Core route is local-only; capture is a fixed main-process IPC operation available only to the trusted main window |
| Caption and tray WebSockets | Passive local data capture or notification injection | Loopback clients only, including proxy/tunnel detection |
| Local model and memory files | Read/write by another local process | OS account permissions; no claim of protection from same-user malware |
| Whisper, Llama, Kokoro, and optional children | Orphans, port capture, command/path substitution | Typed configuration, fixed descriptors, supervisor ownership and process-tree cleanup |
| Electron renderers | Script injection escalating to OS access | Sandbox and context isolation; no Node integration; narrow window-specific preloads; strict CSP and navigation policy |
| Procedural avatar renderer | Script substitution or renderer privilege escalation | Enumerated local source files, strict CSP, sandbox, context isolation, and no model/file-loading protocol |

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

## Electron Security Invariants

- Main and avatar renderers use `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`; `process`, `require`, and raw `ipcRenderer` are not
  present in page context.
- Separate preload bridges expose semantic methods only. There is no generic
  `send`, `invoke`, channel name, file path, command, or arbitrary URL API.
- Every renderer-to-main channel checks the expected window, top-level frame,
  exact `mana-app://app` document URL, and bounded payload shape.
- `mana-app://app` exposes only enumerated renderer source files. Main-process,
  preload, test, dependency, image, and model paths are not protocol-readable.
- Browser navigation, redirects, and new windows are denied. The only external
  link operation opens the fixed local UI URL `http://127.0.0.1:7860/`.
- Permission requests deny by default. Only the trusted main window may request
  audio-only media; video, display capture, geolocation, notifications, USB,
  and other browser permissions are denied.
- Screen capture is implemented as one fixed primary-display operation in the
  main process; the renderer cannot choose a source or capture an arbitrary
  window.
- The supported shell uses Electron 43 and electron-builder 26. The launcher
  development/build toolchain requires Node 22.12 or newer; the separately
  supervised backend remains compatible with its Node 18 runtime contract.

## Threat Scenarios

| Scenario | Disposition |
| --- | --- |
| Another LAN host scans port 5005 | Default listener is unreachable. Explicit LAN mode exposes only `/mobile`. |
| A website calls the loopback API from a browser | No wildcard CORS response is returned. Only `mana-app://app` and explicit exact origins are accepted. |
| A Cloudflare or reverse tunnel targets port 5005 | Proxy/public-host signals force the mobile-only guard; core routes return `403`. |
| A proxy rewrites the host to loopback and strips every forwarding signal | Unsupported and indistinguishable from a local client. Tunnel documentation prohibits this configuration. |
| A remote client calls pairing/device administration | `ADMIN_TOKEN` is required; without it, the request is denied as non-local. |
| A remote client connects to caption or tray WebSockets | Handshake is rejected with `403`. |
| Malicious HTML is loaded inside Electron | Navigation/new-window policy rejects it; if local renderer content is injected, sandboxing, CSP, and narrow preload APIs prevent direct Node/OS access. |
| Same-user malware calls the loopback API directly | Residual local-host risk; CORS is not an authentication boundary for native processes. Electron isolation and route authentication will reduce, not eliminate, this risk. |
| Screen content contains secrets or prompt injection | Screen routes stay local and capture source is fixed. Content remains untrusted input and users must avoid invoking vision over sensitive windows. |
| A child runtime crashes or leaves descendants | Supervisor restart bounds, stop timeouts, Windows process-tree termination, and port-release checks apply. |

## Current Residual Risk

Local same-user processes remain inside the host trust boundary. Mana does not
claim to resist malware already executing as the user. Direct LAN mode is HTTP;
use a TLS tunnel to prevent bearer-token observation on the network.

Screen capture can reveal sensitive data by design and OCR/model input can
contain prompt-injection text. The fixed hotkey and main-window action are user
intent signals, not data-loss prevention. A future product consent indicator or
redaction feature can improve usability but is not treated as an OS security
boundary.

## Verification

The backend security gate covers default and explicit binding validation,
credential strength, exact CORS behavior, LAN request filtering, proxy/tunnel
classification, mobile admin enforcement, and WebSocket rejection:

```powershell
node --test node-bot/test/network-security.test.js
npm test --prefix windows-launcher
npm run test:electron-security --prefix windows-launcher
```

The real Electron smoke loads both custom-protocol documents under the shipped
preload settings and asserts that Node globals are absent and only the expected
semantic bridge methods are visible.
