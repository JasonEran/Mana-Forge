const fs = require("node:fs");
const path = require("node:path");

const { withPath } = require("../config");

function createKokoroServiceDescriptor(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", ".."));
  const ttsDir = path.join(repoRoot, "tts-service");
  const configuredUrl = env.KOKORO_TTS_URL || "http://127.0.0.1:5011";
  const url = new URL(configuredUrl);
  if (url.protocol !== "http:") {
    throw new TypeError("KOKORO_TTS_URL must use HTTP.");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new TypeError("KOKORO_TTS_URL must use a loopback host.");
  }
  if (url.username || url.password) {
    throw new TypeError("KOKORO_TTS_URL must not contain credentials.");
  }
  if (![/^\/?$/, /^\/health\/?$/].some((pattern) => pattern.test(url.pathname))) {
    throw new TypeError(
      "KOKORO_TTS_URL path must be empty, '/', or '/health'.",
    );
  }
  url.search = "";
  url.hash = "";
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  const healthUrl = /\/health\/?$/.test(url.pathname)
    ? url.toString()
    : withPath(url.toString(), "health");
  const port = Number(url.port || 80);

  const python = path.join(ttsDir, "venv", "Scripts", "python.exe");
  const model = path.join(ttsDir, "kokoro", "kokoro-v1.0.int8.onnx");
  const voices = path.join(ttsDir, "kokoro", "voices-v1.0.bin");
  const installed = [python, model, voices].every((file) => fsImpl.existsSync(file));

  return {
    id: "kokoro",
    required: true,
    command: installed ? python : "powershell",
    args: installed
      ? [
          "-m",
          "uvicorn",
          "kokoro_service:app",
          "--host",
          host,
          "--port",
          String(port),
        ]
      : [
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(ttsDir, "start_kokoro.ps1"),
        ],
    cwd: ttsDir,
    env: {
      KOKORO_HOST: host,
      KOKORO_PORT: String(port),
    },
    healthUrl,
    allowExisting: true,
    startupTimeoutMs: parsePositiveInteger(
      env.MANA_KOKORO_STARTUP_TIMEOUT_MS,
      installed ? 60_000 : 600_000,
      "MANA_KOKORO_STARTUP_TIMEOUT_MS",
    ),
    shutdownTimeoutMs: parsePositiveInteger(
      env.MANA_KOKORO_SHUTDOWN_TIMEOUT_MS,
      10_000,
      "MANA_KOKORO_SHUTDOWN_TIMEOUT_MS",
    ),
    restart: {
      enabled: true,
      maxAttempts: 2,
      baseDelayMs: 1_000,
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
  createKokoroServiceDescriptor,
};
