# Backend architecture

## Boundary

The supported backend is one Node process. `server.js` is the process entry
point and composition root; it does not own HTTP domain behavior. Route ownership is defined in
`architecture/route-ownership.js` and enforced by
`test/backend-architecture.test.js`.

## Current composition

```text
RuntimeSupervisor
  -> startServer()
       -> createApp()
            -> registerRoutes()
                 -> capability registry
                 -> editor routes
                 -> debug routes
                 -> admin and retriever routes
                 -> runtime status routes
                 -> core routes
                      -> conversation routes
                      -> speech routes
                 -> model routes
                 -> diagnostic routes
                 -> VTube Studio routes
                 -> mobile routes
            -> admin static files
       -> caption and tray WebSocket adapters
       -> explicit background-memory lifecycle
       -> one HTTP listen call
```

| Owner | Public surface | State |
| --- | --- | --- |
| `server.js` | application composition and admin static mount | Composition root |
| `editor-routes.js` | `/zed`, `/editors` | Owned domain module |
| `debug-routes.js` | `/debug` | Owned domain module |
| `admin-routes.js` | admin memory, retriever, token cache and tray APIs | Owned domain module |
| `admin-ui-routes.js` | local admin HTML pages | Owned adapter |
| `runtime-status-routes.js` | `/gaming/status`, `/perf/status` | Owned domain module |
| `server-routes.js` | screen/vision, stock market, restart | Transitional |
| `conversation-routes.js` | `/reply` | Owned domain module |
| `speech-routes.js` | `/transcribe-only`, `/transcribe`, `/synthesize` | Owned domain module |
| `model-routes.js` | `/models` | Owned domain module |
| `diagnostic-routes.js` | `/health`, `/doctor` | Owned domain module |
| `mobile-routes.js` | `/mobile` | Owned module |
| `vtube-routes.js` | `/vtube` | Owned module |
| FFXIV capability | `/ffxiv` | Owned capability |
| Web access capability | `/web`, `/wiki` | Owned capability |
| Directory scanner capability | `/tools/dir-scan` | Owned capability |

"Transitional" means the route has an explicit current owner but still needs
extraction into its target domain. It does not mean that `server.js` is the
desired long-term owner.

## Lifecycle

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

`background-lifecycle.js` owns scheduler state through idempotent `start()` and
`stop()` methods. `startServer()` starts it explicitly and server close/error
stops it, clearing timers and settling active jobs. Importing `server.js` and
calling `createApp()` do not start scheduled work.
