const path = require("node:path");

const { resolveDataDir, withPath } = require("../config");
const { createNetworkSecurityConfig } = require("../network-security");
const {
  OPTIONAL_CAPABILITIES,
} = require("../../node-bot/capabilities/manifest");

function createBackendServiceDescriptor(options = {}) {
  const env = options.env || process.env;
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", ".."));
  const configuredUrl =
    options.backendUrl || env.MANA_BACKEND_URL || "http://127.0.0.1:5005";
  const parsedConfiguredUrl = new URL(configuredUrl);
  if (!["http:", "https:"].includes(parsedConfiguredUrl.protocol)) {
    throw new TypeError("MANA_BACKEND_URL must use HTTP or HTTPS.");
  }
  if (parsedConfiguredUrl.username || parsedConfiguredUrl.password) {
    throw new TypeError("MANA_BACKEND_URL must not contain credentials.");
  }
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(parsedConfiguredUrl.hostname)
  ) {
    throw new TypeError("MANA_BACKEND_URL must use a loopback host.");
  }
  parsedConfiguredUrl.search = "";
  parsedConfiguredUrl.hash = "";
  const backendUrl = /\/health\/?$/.test(parsedConfiguredUrl.pathname)
    ? parsedConfiguredUrl.toString()
    : withPath(parsedConfiguredUrl.toString(), "health");
  const parsedUrl = new URL(backendUrl);
  const port = Number(
    parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
  );
  const networkSecurity = createNetworkSecurityConfig(env);
  const dataDir = resolveDataDir(
    env,
    options.dataDir || path.join(repoRoot, "node-bot", "data"),
  );

  return {
    id: "backend",
    required: true,
    command: options.command || "node",
    args: [path.join(repoRoot, "node-bot", "server.js")],
    cwd: path.join(repoRoot, "node-bot"),
    env: {
      MANA_PROFILE: env.MANA_PROFILE || "core",
      ...Object.fromEntries(
        OPTIONAL_CAPABILITIES.map((capability) => [
          capability.flag,
          env[capability.flag] || "0",
        ]),
      ),
      MANA_ALLOW_REMOTE_ACCESS: networkSecurity.remoteAccessRequested ? "1" : "0",
      MANA_BACKEND_HOST: networkSecurity.host,
      MANA_CORS_ALLOWED_ORIGINS: env.MANA_CORS_ALLOWED_ORIGINS || "",
      MANA_CONFIG_FILE: env.MANA_CONFIG_FILE || "",
      MANA_DATA_DIR: dataDir,
      MANA_ACP_MEMORY_DIR:
        env.MANA_ACP_MEMORY_DIR || path.join(dataDir, "acp-memory"),
      MOBILE_MEMORY_DIR:
        env.MOBILE_MEMORY_DIR || path.join(dataDir, "mobile"),
      VECTOR_STORE_DIR:
        env.VECTOR_STORE_DIR || path.join(dataDir, "vector_store"),
      SCREEN_OCR_CACHE_PATH:
        env.SCREEN_OCR_CACHE_PATH || path.join(dataDir, "tmp", "tesseract"),
      MOBILE_PASSCODE_HASH: env.MOBILE_PASSCODE_HASH || "",
      MOBILE_SESSION_SECRET: env.MOBILE_SESSION_SECRET || "",
      MOBILE_SESSION_TTL_MS: env.MOBILE_SESSION_TTL_MS || "43200000",
      PORT: String(port),
      VTUBE_STUDIO_URL:
        env.VTUBE_STUDIO_URL || "ws://127.0.0.1:8001",
    },
    healthUrl: backendUrl,
    allowExisting: options.allowExisting !== false,
    startupTimeoutMs: parsePositiveInteger(
      env.MANA_BACKEND_STARTUP_TIMEOUT_MS,
      30_000,
      "MANA_BACKEND_STARTUP_TIMEOUT_MS",
    ),
    shutdownTimeoutMs: parsePositiveInteger(
      env.MANA_BACKEND_SHUTDOWN_TIMEOUT_MS,
      5_000,
      "MANA_BACKEND_SHUTDOWN_TIMEOUT_MS",
    ),
    restart: {
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5_000,
    },
  };
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

module.exports = {
  createBackendServiceDescriptor,
};
