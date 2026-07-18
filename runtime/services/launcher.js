const fs = require("node:fs");
const path = require("node:path");

const { withPath } = require("../config");
const { createBackendServiceDescriptor } = require("./backend");
const { createKokoroServiceDescriptor } = require("./kokoro");

function createLauncherServicePlan(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", ".."));
  const descriptors = [
    createBackendServiceDescriptor({
      env,
      repoRoot,
      command: options.command,
      dataDir: options.dataDir,
    }),
  ];
  const warnings = [];
  const provider = String(env.TTS_PROVIDER || "kokoro").trim().toLowerCase();

  if (provider === "kokoro" && env.MANA_START_KOKORO !== "0") {
    descriptors.push(createKokoroServiceDescriptor({ env, fsImpl, repoRoot }));
  } else if (provider === "chatterbox") {
    descriptors.push(createChatterboxDescriptor({ env, repoRoot }));
    addKokoroFallback(descriptors, { env, fsImpl, repoRoot });
  } else if (provider === "gpt_sovits") {
    const gpt = createGptSovitsDescriptor({ env, fsImpl, repoRoot });
    if (gpt.descriptor) descriptors.push(gpt.descriptor);
    if (gpt.warning) warnings.push(gpt.warning);
    if (!gpt.descriptor) {
      descriptors.push(
        createKokoroServiceDescriptor({
          env,
          fsImpl,
          repoRoot,
          id: "kokoro-fallback",
          required: false,
        }),
      );
    } else {
      addKokoroFallback(descriptors, { env, fsImpl, repoRoot });
    }
  }

  if (
    provider === "kokoro" &&
    env.START_FALLBACK_CHATTERBOX === "1"
  ) {
    descriptors.push(
      createChatterboxDescriptor({
        env,
        repoRoot,
        id: "chatterbox-fallback",
        required: false,
      }),
    );
  }

  if (env.MANA_START_RETRIEVER !== "0") {
    const retriever = createRetrieverDescriptor({ env, fsImpl, repoRoot });
    if (retriever.descriptor) descriptors.push(retriever.descriptor);
    if (retriever.warning) warnings.push(retriever.warning);
  }

  if (env.MANA_START_SEARXNG !== "0") {
    const searxng = createSearxngDescriptor({ env, fsImpl, repoRoot });
    if (searxng.descriptor) descriptors.push(searxng.descriptor);
    if (searxng.warning) warnings.push(searxng.warning);
  }

  return { descriptors, warnings };
}

function createChatterboxDescriptor(options) {
  const { env, repoRoot } = options;
  const ttsDir = path.join(repoRoot, "tts-service");
  const endpoint = parseLoopbackHttpUrl(
    env.CHATTERBOX_TTS_URL || "http://127.0.0.1:5010",
    "CHATTERBOX_TTS_URL",
  );
  return {
    id: options.id || "chatterbox",
    required: false,
    command: "powershell",
    args: [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(ttsDir, "start.ps1"),
    ],
    cwd: ttsDir,
    env: {
      CHATTERBOX_HOST: endpoint.host,
      CHATTERBOX_PORT: String(endpoint.port),
    },
    healthUrl: endpoint.healthUrl,
    allowExisting: true,
    startupTimeoutMs: 600_000,
    shutdownTimeoutMs: 10_000,
    restart: restartPolicy(2, 1_000),
  };
}

function createGptSovitsDescriptor({ env, fsImpl, repoRoot }) {
  const gptDir = path.join(repoRoot, "tools", "gpt-sovits");
  const runtimePython = path.join(gptDir, "runtime", "python.exe");
  const apiScript = path.join(gptDir, "api_v2.py");
  if (!fsImpl.existsSync(runtimePython) || !fsImpl.existsSync(apiScript)) {
    return {
      descriptor: null,
      warning: `GPT-SoVITS runtime is missing at ${gptDir}; using the configured Kokoro fallback when available.`,
    };
  }
  const endpoint = parseLoopbackHttpUrl(
    env.GPT_SOVITS_TTS_URL || "http://127.0.0.1:9880",
    "GPT_SOVITS_TTS_URL",
    { healthPath: false },
  );
  return {
    descriptor: {
      id: "gpt-sovits",
      required: false,
      command: runtimePython,
      args: [apiScript, "-a", endpoint.host, "-p", String(endpoint.port)],
      cwd: gptDir,
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      healthUrl: endpoint.baseUrl,
      readinessProbe: async () => {
        try {
          await fetch(endpoint.baseUrl, { redirect: "manual" });
          return true;
        } catch (_error) {
          return false;
        }
      },
      allowExisting: true,
      startupTimeoutMs: 120_000,
      shutdownTimeoutMs: 10_000,
      restart: restartPolicy(2, 1_000),
    },
    warning: null,
  };
}

function createRetrieverDescriptor({ env, fsImpl, repoRoot }) {
  const script = path.join(repoRoot, "tools", "retriever_service.py");
  if (!fsImpl.existsSync(script)) {
    return {
      descriptor: null,
      warning: `Retriever script is missing at ${script}; skipping optional service.`,
    };
  }
  const venvPython = path.join(repoRoot, "venv", "Scripts", "python.exe");
  const endpoint = parseLoopbackHttpUrl(
    env.RETRIEVER_HEALTH_URL || "http://127.0.0.1:9000/health",
    "RETRIEVER_HEALTH_URL",
    { preservePath: true },
  );
  if (!/\/health\/?$/.test(new URL(endpoint.baseUrl).pathname)) {
    throw new TypeError("RETRIEVER_HEALTH_URL must end with '/health'.");
  }
  return {
    descriptor: {
      id: "retriever",
      required: false,
      command: fsImpl.existsSync(venvPython) ? venvPython : "python",
      args: ["-u", script],
      cwd: repoRoot,
      env: {
        RETRIEVER_HOST: endpoint.host,
        RETRIEVER_PORT: String(endpoint.port),
      },
      healthUrl: endpoint.baseUrl,
      allowExisting: true,
      startupTimeoutMs: 300_000,
      shutdownTimeoutMs: 10_000,
      restart: restartPolicy(1, 2_000),
    },
    warning: null,
  };
}

function createSearxngDescriptor({ env, fsImpl, repoRoot }) {
  const searxngDir = path.join(repoRoot, "tools", "searxng");
  const python = path.join(searxngDir, "venv", "Scripts", "python.exe");
  if (!fsImpl.existsSync(python)) {
    return {
      descriptor: null,
      warning: `SearXNG runtime is missing at ${python}; skipping optional service.`,
    };
  }
  const endpoint = parseLoopbackHttpUrl(
    "http://127.0.0.1:8890",
    "SEARXNG_URL",
    { healthPath: false },
  );
  return {
    descriptor: {
      id: "searxng",
      required: false,
      command: python,
      args: ["-m", "searx.webapp"],
      cwd: searxngDir,
      env: {
        SEARXNG_SETTINGS_PATH: path.join(searxngDir, "mana-settings.yml"),
      },
      healthUrl: endpoint.baseUrl,
      allowExisting: true,
      startupTimeoutMs: 60_000,
      shutdownTimeoutMs: 10_000,
      restart: restartPolicy(1, 1_000),
    },
    warning: null,
  };
}

function addKokoroFallback(descriptors, options) {
  if (options.env.MANA_START_KOKORO_FALLBACK === "0") return;
  descriptors.push(
    createKokoroServiceDescriptor({
      ...options,
      id: "kokoro-fallback",
      required: false,
    }),
  );
}

function parseLoopbackHttpUrl(value, name, options = {}) {
  const url = new URL(value);
  if (url.protocol !== "http:") throw new TypeError(`${name} must use HTTP.`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new TypeError(`${name} must use a loopback host.`);
  }
  if (url.username || url.password) {
    throw new TypeError(`${name} must not contain credentials.`);
  }
  url.search = "";
  url.hash = "";
  const host = url.hostname === "[::1]" ? "::1" : url.hostname;
  const port = Number(url.port || 80);
  if (!options.preservePath) url.pathname = "/";
  const baseUrl = url.toString();
  return {
    host,
    port,
    baseUrl,
    healthUrl: options.healthPath === false ? baseUrl : withPath(baseUrl, "health"),
  };
}

function restartPolicy(maxAttempts, baseDelayMs) {
  return { enabled: true, maxAttempts, baseDelayMs, maxDelayMs: 5_000 };
}

module.exports = {
  createLauncherServicePlan,
};
