# Backend architecture

## Boundary

The supported backend is one Node process. `server.js` is the process entry
point and temporary composition root; it must not become the permanent owner of
domain behavior. Route ownership is defined in
`architecture/route-ownership.js` and enforced by
`test/backend-architecture.test.js`.

## Current composition

```text
RuntimeSupervisor
  -> startServer()
       -> createApp()
            -> transitional registerRoutes()
                 -> capability registry
                 -> transitional core routes
                      -> conversation routes
                      -> speech routes
                 -> VTube Studio routes
                 -> mobile routes
            -> admin static files
       -> caption and tray WebSocket adapters
       -> one HTTP listen call
```

| Owner | Public surface | State |
| --- | --- | --- |
| `server.js` | health, Doctor, editor/model status, admin memory/retriever, gaming/perf | Transitional |
| `server-routes.js` | screen/vision, stock market, restart | Transitional |
| `conversation-routes.js` | `/reply` | Owned domain module |
| `speech-routes.js` | `/transcribe-only`, `/transcribe`, `/synthesize` | Owned domain module |
| `mobile-routes.js` | `/mobile` | Owned module |
| `vtube-routes.js` | `/vtube` | Owned module |
| FFXIV capability | `/ffxiv` | Owned capability |
| Web access capability | `/web`, `/wiki` | Owned capability |
| Directory scanner capability | `/tools/dir-scan` | Owned capability |

"Transitional" means the route has an explicit current owner but still needs
extraction into its target domain. It does not mean that `server.js` is the
desired long-term owner.

## Target composition

```text
server.js
  -> application factory
       -> conversation routes/service
       -> speech routes/service
       -> model routes/service
       -> memory routes/service
       -> admin routes/service
       -> capability registry
  -> backend lifecycle
       -> start background jobs
       -> start HTTP/WebSocket server
       -> stop jobs and close server
```

Extraction order is conversation and speech, models, memory/admin, then
background-job lifecycle. Each extraction must preserve public paths and
response schemas, inject its dependencies, update the ownership map, and land
as a separately reversible PR.
