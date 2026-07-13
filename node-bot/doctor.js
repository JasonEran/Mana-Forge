const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { loadManaConfig } = require("../runtime/config");
const {
  createBackendServiceDescriptor,
} = require("../runtime/services/backend");
const {
  createKokoroServiceDescriptor,
} = require("../runtime/services/kokoro");
const { createEditorIntegrations } = require("./zed-integration");
const { assertLocalAiPolicy } = require("./mana-acp-agent");

loadManaConfig();

const DEFAULT_NODE_MAJOR = 18;

function checkPathExists(filePath) {
  return typeof filePath === "string" && filePath.trim() && fs.existsSync(filePath);
}

function hasRemoteAiEnabled(env) {
  return String(env.MANA_ALLOW_REMOTE_AI || "").trim() === "1";
}

function normalizeStatus(status) {
  return ["pass", "warn", "fail"].includes(status) ? status : "warn";
}

function makeCheck(id, label, status, message, details = {}) {
  return {
    id,
    label,
    status: normalizeStatus(status),
    message,
    details,
  };
}

function summarizeChecks(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function getNodeMajor(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function checkNodeRuntime(version) {
  const major = getNodeMajor(version);
  if (major >= DEFAULT_NODE_MAJOR) {
    return makeCheck(
      "node-runtime",
      "Node runtime",
      "pass",
      `Node ${version} is available.`,
      { version },
    );
  }

  return makeCheck(
    "node-runtime",
    "Node runtime",
    "fail",
    `Node ${version || "unknown"} is too old. Use Node ${DEFAULT_NODE_MAJOR} or newer.`,
    { version },
  );
}

function checkLocalAiPolicy(env) {
  if (!hasRemoteAiEnabled(env)) {
    return makeCheck(
      "local-ai-policy",
      "Local AI policy",
      "pass",
      "Remote AI is disabled.",
    );
  }

  return makeCheck(
    "local-ai-policy",
    "Local AI policy",
    "warn",
    "Remote AI is enabled. Set MANA_ALLOW_REMOTE_AI=0 for strictly local replies.",
  );
}

function checkRequiredFile(id, label, filePath, missingConfigMessage) {
  if (!filePath) {
    return makeCheck(id, label, "warn", missingConfigMessage);
  }

  if (checkPathExists(filePath)) {
    return makeCheck(id, label, "pass", `${label} found.`, {
      path: filePath,
    });
  }

  return makeCheck(id, label, "fail", `${label} not found at configured path.`, {
    path: filePath,
  });
}

function checkWhisperConfig(env) {
  const bin = env.WHISPER_BIN || "";
  const model = env.WHISPER_MODEL || "";

  if (!bin && !model) {
    return makeCheck(
      "whisper-config",
      "Whisper config",
      "warn",
      "Whisper is not configured. Voice transcription will be unavailable.",
    );
  }

  if (checkPathExists(bin) && checkPathExists(model)) {
    return makeCheck(
      "whisper-config",
      "Whisper config",
      "pass",
      "Whisper binary and model are configured.",
      { bin, model },
    );
  }

  return makeCheck(
    "whisper-config",
    "Whisper config",
    "fail",
    "Whisper binary or model path is missing.",
    { bin, model },
  );
}

function checkTtsServices(services = []) {
  if (!services.length) {
    return makeCheck(
      "tts-services",
      "TTS services",
      "warn",
      "No TTS service checks were configured.",
    );
  }

  const available = services.filter((service) => service.ok);
  if (available.length > 0) {
    return makeCheck(
      "tts-services",
      "TTS services",
      "pass",
      `${available.length} TTS service check passed.`,
      { services },
    );
  }

  return makeCheck("tts-services", "TTS services", "warn", "No TTS service responded.", {
    services,
  });
}

function checkMobileAuth(env) {
  const hash = env.MOBILE_PASSCODE_HASH || env.MANA_MOBILE_PASSCODE_HASH || "";
  const secret = env.MOBILE_SESSION_SECRET || "";

  if (hash && secret) {
    return makeCheck(
      "mobile-auth",
      "Mobile auth",
      "pass",
      "Mobile passcode hash and session secret are configured.",
    );
  }

  return makeCheck(
    "mobile-auth",
    "Mobile auth",
    "warn",
    "Mobile passcode hash or session secret is missing.",
  );
}

function checkStorage(paths = {}) {
  const dataDir = paths.dataDir || path.join(__dirname, "data");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    return makeCheck("storage", "Storage", "pass", "Local storage is writable.", {
      dataDir,
    });
  } catch (error) {
    return makeCheck("storage", "Storage", "fail", "Local storage is not writable.", {
      dataDir,
      error: error.message,
    });
  }
}

function checkEditorIntegrations(options = {}) {
  const status = createEditorIntegrations({
    env: options.env || process.env,
    commandResolver: options.commandResolver,
  }).getStatus();

  return Object.entries(status.editors).map(([id, editor]) =>
    makeCheck(
      `${id}-editor`,
      id === "vscode" ? "VS Code editor" : "Zed editor",
      editor.available ? "pass" : "warn",
      editor.message,
      {
        command: editor.command,
        source: editor.source,
        defaultEditor: status.defaultEditor === id,
      },
    ),
  );
}

function checkZedExternalAgent(options = {}) {
  const env = options.env || process.env;
  const entryPoint = options.entryPoint || path.join(__dirname, "mana-acp-agent.js");

  if (!checkPathExists(entryPoint)) {
    return makeCheck(
      "zed-external-agent",
      "Zed external agent",
      "fail",
      "Mana external agent entry point is missing.",
      {
        entryPoint,
        command: `node ${entryPoint} --acp`,
      },
    );
  }

  try {
    const localAi = assertLocalAiPolicy(env, {
      allowRemoteOverride: options.allowRemoteOverride === true,
    });
    return makeCheck(
      "zed-external-agent",
      "Zed external agent",
      "pass",
      "Mana external agent entry point is available.",
      {
        entryPoint,
        command: `node ${entryPoint} --acp`,
        remoteAllowed: localAi.remoteAllowed,
        mode: localAi.mode,
      },
    );
  } catch (error) {
    return makeCheck(
      "zed-external-agent",
      "Zed external agent",
      "warn",
      error.message,
      {
        entryPoint,
        command: `node ${entryPoint} --acp`,
        remoteAllowed: true,
      },
    );
  }
}

function buildRuntimeDiagnosticState(env, options = {}) {
  const state = { backend: null, kokoro: null, errors: [] };
  try {
    state.backend = createBackendServiceDescriptor({
      env,
      repoRoot: options.repoRoot,
    });
  } catch (error) {
    state.errors.push({ serviceId: "backend", message: error.message });
  }

  const provider = String(env.TTS_PROVIDER || "kokoro").trim().toLowerCase();
  if (provider === "kokoro") {
    try {
      state.kokoro = createKokoroServiceDescriptor({
        env,
        repoRoot: options.repoRoot,
        fsImpl: options.fsImpl,
      });
    } catch (error) {
      state.errors.push({ serviceId: "kokoro", message: error.message });
    }
  }
  return state;
}

function checkRuntimeDiagnosticState(runtimeState) {
  const services = [runtimeState.backend, runtimeState.kokoro]
    .filter(Boolean)
    .map((descriptor) => ({
      id: descriptor.id,
      required: descriptor.required,
      healthUrl: descriptor.healthUrl,
      startupTimeoutMs: descriptor.startupTimeoutMs,
      shutdownTimeoutMs: descriptor.shutdownTimeoutMs,
    }));

  if (runtimeState.errors.length) {
    return makeCheck(
      "runtime-config",
      "Runtime configuration",
      "fail",
      `${runtimeState.errors.length} runtime service configuration error(s).`,
      { services, errors: runtimeState.errors },
    );
  }

  return makeCheck(
    "runtime-config",
    "Runtime configuration",
    "pass",
    `${services.length} runtime service descriptor(s) are valid.`,
    { services, errors: [] },
  );
}

function getZedExternalAgentBackendHealthTarget(runtimeState) {
  return runtimeState.backend?.healthUrl || "";
}

function withHealthPath(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/health";
    }
    return url.toString();
  } catch (error) {
    return "";
  }
}

function getConfiguredTtsHealthTargets(env, runtimeState) {
  const provider = String(env.TTS_PROVIDER || "").trim().toLowerCase();
  const targets = [];

  if ((!provider || provider === "chatterbox") && env.CHATTERBOX_TTS_URL) {
    targets.push({
      id: "chatterbox",
      url: withHealthPath(env.CHATTERBOX_TTS_URL),
    });
  }

  if (!provider || provider === "kokoro") {
    if (runtimeState.kokoro) {
      targets.push({ id: "kokoro", url: runtimeState.kokoro.healthUrl });
    }
  }

  if ((!provider || provider === "fish") && env.FISH_TTS_URL) {
    targets.push({
      id: "fish",
      url: withHealthPath(env.FISH_TTS_URL),
    });
  }

  return targets.filter((target) => target.url);
}

async function probeHttpHealth({ id, url, timeoutMs = 750 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return {
      id,
      url,
      ok: response.ok,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      id,
      url,
      ok: false,
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeTtsServices(env, services, runtimeState) {
  if (Array.isArray(services)) {
    return services;
  }

  const targets = getConfiguredTtsHealthTargets(env, runtimeState);
  return Promise.all(targets.map((target) => probeHttpHealth(target)));
}

async function probeZedExternalAgentBackend(
  env,
  runtimeState,
  probe = probeHttpHealth,
) {
  const url = getZedExternalAgentBackendHealthTarget(runtimeState);
  if (!url) {
    return makeCheck(
      "zed-external-agent-backend",
      "Zed external agent backend",
      "warn",
      "Backend runtime configuration is invalid; see the runtime-config check.",
      {},
    );
  }

  const result = await probe({
    id: "zed-external-agent-backend",
    url,
  });
  return makeCheck(
    "zed-external-agent-backend",
    "Zed external agent backend",
    result.ok ? "pass" : "warn",
    result.ok
      ? "Zed external agent local backend is reachable."
      : "Zed external agent local backend is not reachable. Start node-bot before using Zed External Agent.",
    result,
  );
}

async function probeSearxngHealth(env, probe = probeHttpHealth) {
  if (env.MANA_WEB_ACCESS_ENABLED === "0") {
    return makeCheck(
      "searxng",
      "Web search (SearXNG)",
      "warn",
      "Web access is disabled (MANA_WEB_ACCESS_ENABLED=0).",
      {},
    );
  }

  const url = (env.SEARXNG_URL || "http://127.0.0.1:8890").replace(/\/+$/, "") + "/";
  const result = await probe({ id: "searxng", url });
  return makeCheck(
    "searxng",
    "Web search (SearXNG)",
    result.ok ? "pass" : "warn",
    result.ok
      ? "Local SearXNG is reachable; web search is available."
      : "Local SearXNG is not reachable. Web search will fail; wiki lookups and pointed-at page reads still work. See docs/web_access_setup.md.",
    result,
  );
}

// GPT-SoVITS's api_v2.py has no /health route, so this only checks whether
// the port answers at all (see the matching launcher-side isGptSovitsRunning);
// only relevant when it's the selected trial voice provider.
async function probeGptSovitsHealth(env, probe = probeHttpHealth) {
  const url = (env.GPT_SOVITS_TTS_URL || "http://127.0.0.1:9880") + "/";
  const result = await probe({ id: "gpt-sovits", url });
  const reachable = result.ok || Number.isInteger(result.statusCode);
  return makeCheck(
    "gpt-sovits",
    "GPT-SoVITS (trial voice)",
    reachable ? "pass" : "warn",
    reachable
      ? "GPT-SoVITS is reachable."
      : "TTS_PROVIDER is gpt_sovits, but GPT-SoVITS is not reachable. See docs/gpt_sovits_setup.md.",
    { ...result, ok: reachable },
  );
}

function getDefaultPortChecks(runtimeState) {
  if (!runtimeState.backend) return [];
  const url = new URL(runtimeState.backend.healthUrl);
  return [{
    id: "mana-backend",
    host: url.hostname === "[::1]" ? "::1" : url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  }];
}

function probePortAvailability({ id = "port", host = "127.0.0.1", port, timeoutMs = 500 }) {
  return new Promise((resolve) => {
    if (!port) {
      resolve({ id, host, port, ok: false, error: "missing port" });
      return;
    }

    const socket = net.createConnection({ host, port });
    const finish = (ok, error = "") => {
      socket.removeAllListeners();
      socket.destroy();
      resolve({ id, host, port, ok, error });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(false, "port is already in use"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        finish(true);
        return;
      }
      finish(false, error.code || error.message);
    });
  });
}

async function probePorts(ports = []) {
  return Promise.all(ports.map((port) => probePortAvailability(port)));
}

function buildDoctorResult(checks, now = () => new Date()) {
  const summary = summarizeChecks(checks);
  return {
    ok: summary.fail === 0,
    generatedAt: now().toISOString(),
    summary,
    checks,
  };
}

function runDoctorChecks(options = {}) {
  const env = options.env || process.env;
  const versions = options.versions || { node: process.version };
  const paths = options.paths || {
    dataDir: env.MOBILE_MEMORY_DIR || path.join(__dirname, "data"),
  };

  const checks = [
    checkNodeRuntime(versions.node),
    checkLocalAiPolicy(env),
    checkRequiredFile(
      "llama-binary",
      "Llama binary",
      env.LLAMA_BIN || "",
      "LLAMA_BIN is not configured. Local replies will use a placeholder.",
    ),
    checkRequiredFile(
      "llama-model",
      "Llama model",
      env.LLAMA_MODEL || "",
      "LLAMA_MODEL is not configured. Local replies will use a placeholder.",
    ),
    checkRequiredFile(
      "llama-server-binary",
      "Llama server binary",
      env.LLAMA_SERVER_BIN || "",
      "LLAMA_SERVER_BIN is not configured. Mana auto-detects the bundled llama-server.exe and falls back to one-shot llama-cli replies.",
    ),
    checkRequiredFile(
      "llama-vision-model",
      "Llama vision model",
      env.LLAMA_VISION_MODEL || "",
      "LLAMA_VISION_MODEL is not configured. Mana auto-detects vision GGUF models under tools/llama; image replies stay unavailable until one is installed. See docs/vision_setup.md.",
    ),
    checkWhisperConfig(env),
    checkTtsServices(options.services || []),
    checkMobileAuth(env),
    checkStorage(paths),
    ...checkEditorIntegrations({
      env,
      commandResolver: options.zedCommandResolver,
    }),
    checkZedExternalAgent({
      env,
      entryPoint: options.zedExternalAgentEntryPoint,
      allowRemoteOverride: options.allowRemoteOverride,
    }),
  ];

  return buildDoctorResult(checks, options.now);
}

async function runDoctorChecksAsync(options = {}) {
  const env = options.env || process.env;
  const runtimeState = buildRuntimeDiagnosticState(env, options.runtime);
  const services = await probeTtsServices(
    env,
    options.services,
    runtimeState,
  );
  const zedExternalAgentBackend = await probeZedExternalAgentBackend(
    env,
    runtimeState,
    options.zedExternalAgentBackendProbe,
  );
  const searxngHealth = await probeSearxngHealth(env, options.searxngProbe);
  const gptSovitsHealth =
    String(env.TTS_PROVIDER || "").trim().toLowerCase() === "gpt_sovits"
      ? await probeGptSovitsHealth(env, options.gptSovitsProbe)
      : null;
  const portChecks = [
    ...getDefaultPortChecks(runtimeState),
    ...(options.ports || []),
  ];
  const portResults = await probePorts(portChecks);
  const checks = runDoctorChecks({
    ...options,
    env,
    services,
  }).checks;

  checks.push(checkRuntimeDiagnosticState(runtimeState));
  checks.push(zedExternalAgentBackend);
  checks.push(searxngHealth);
  if (gptSovitsHealth) {
    checks.push(gptSovitsHealth);
  }

  if (portResults.length) {
    const unavailable = portResults.filter((port) => !port.ok);
    checks.push(
      makeCheck(
        "ports",
        "Ports",
        unavailable.length ? "warn" : "pass",
        unavailable.length
          ? `${unavailable.length} configured port is unavailable.`
          : "Configured ports are available.",
        { ports: portResults },
      ),
    );
  }

  return buildDoctorResult(checks, options.now);
}

if (require.main === module) {
  runDoctorChecksAsync()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}${os.EOL}`);
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`Mana doctor failed: ${error.message}${os.EOL}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildDoctorResult,
  runDoctorChecks,
  runDoctorChecksAsync,
};
