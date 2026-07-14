const ROUTE_OWNERS = Object.freeze([
  {
    id: "admin",
    source: "admin-routes.js",
    status: "owned",
    patterns: [
      "/admin/pending-writes",
      "/admin/pending-writes/*",
      "/admin/token-cache",
      "/admin/token-cache/*",
      "/admin/token-cache-metrics",
      "/admin/background-memory/*",
      "/admin/retriever/*",
      "/admin/notify/*",
    ],
  },
  {
    id: "composition",
    source: "server.js",
    status: "owned",
    patterns: ["/admin/mobile-devices"],
  },
  {
    id: "editors",
    source: "editor-routes.js",
    status: "owned",
    patterns: ["/zed/*", "/editors/*"],
  },
  {
    id: "debug",
    source: "debug-routes.js",
    status: "owned",
    patterns: ["/debug/*"],
  },
  {
    id: "runtime-status",
    source: "runtime-status-routes.js",
    status: "owned",
    patterns: ["/gaming/*", "/perf/*"],
  },
  {
    id: "admin-ui",
    source: "admin-ui-routes.js",
    status: "owned",
    patterns: ["/admin/token-cache-ui", "/admin/background-memory-ui"],
  },
  {
    id: "diagnostics",
    source: "diagnostic-routes.js",
    status: "owned",
    patterns: ["/doctor", "/health"],
  },
  {
    id: "models",
    source: "model-routes.js",
    status: "owned",
    patterns: ["/models/*"],
  },
  {
    id: "core-routes",
    source: "server-routes.js",
    status: "transitional",
    patterns: [
      "/admin/restart",
      "/screen/read",
      "/market/stock/*",
      "/market/watchlist",
      "/vision/describe",
    ],
  },
  {
    id: "conversation",
    source: "conversation-routes.js",
    status: "owned",
    patterns: ["/reply"],
  },
  {
    id: "speech",
    source: "speech-routes.js",
    status: "owned",
    patterns: ["/transcribe-only", "/transcribe", "/synthesize"],
  },
  {
    id: "mobile",
    source: "mobile-routes.js",
    mountPath: "/mobile",
    status: "owned",
    patterns: ["/mobile", "/mobile/*"],
  },
  {
    id: "vtube-studio",
    source: "vtube-routes.js",
    status: "owned",
    patterns: ["/vtube/*"],
  },
  {
    id: "ffxiv-market",
    source: "capabilities/ffxiv-market-capability.js",
    status: "owned",
    patterns: ["/ffxiv/*"],
  },
  {
    id: "web-access",
    source: "capabilities/web-access-capability.js",
    status: "owned",
    patterns: ["/web/*", "/wiki/*"],
  },
  {
    id: "directory-scanner",
    source: "capabilities/dir-scanner-capability.js",
    status: "owned",
    patterns: ["/tools/dir-scan"],
  },
]);

module.exports = {
  ROUTE_OWNERS,
};
