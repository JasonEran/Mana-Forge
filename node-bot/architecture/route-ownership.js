const ROUTE_OWNERS = Object.freeze([
  {
    id: "composition-legacy",
    source: "server.js",
    status: "transitional",
    patterns: [
      "/doctor",
      "/health",
      "/zed/*",
      "/editors/*",
      "/models/*",
      "/debug/*",
      "/admin/*",
      "/gaming/*",
      "/perf/*",
    ],
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
