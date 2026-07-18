const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  app,
  BrowserWindow,
  ipcMain,
  net: electronNet,
  protocol,
  session,
} = require("electron");
const { loadManaConfig } = require("../../runtime/config");
const { resolveBundledNode } = require("../../runtime/node-runtime");
const { createLauncherServicePlan } = require("../../runtime/services/launcher");
const { RuntimeSupervisor } = require("../../runtime/supervisor");
const {
  OPTIONAL_CAPABILITIES,
} = require("../../node-bot/capabilities/manifest");
const { checkCoreReleaseBudgets } = require("../../scripts/check-quality-budgets");
const {
  assertLocalProviderResults,
  collectProcessTree,
  normalizeGpuSamples,
  normalizeProcessRows,
  summarizeRuntimeResources,
  validateCoreReleaseEvidence,
} = require("../../scripts/core-release-evidence");
const { IPC_CHANNELS } = require("../electron-security");
const {
  APP_ORIGIN,
  installLocalProtocols,
  registerPrivilegedSchemes,
} = require("../local-protocol");

const repoRoot = path.resolve(__dirname, "..", "..");
const launcherRoot = path.join(repoRoot, "windows-launcher");
const outputPath = process.env.MANA_CORE_RELEASE_EVIDENCE_FILE;
const tempRoot = process.env.MANA_CORE_RELEASE_TEMP_DIR;
const ports = Object.freeze({ backend: 5005, kokoro: 5011, llama: 8090 });
const supervisor = new RuntimeSupervisor();
const windows = [];

assert.ok(outputPath, "MANA_CORE_RELEASE_EVIDENCE_FILE is required");
assert.ok(tempRoot, "MANA_CORE_RELEASE_TEMP_DIR is required");
assert.equal(process.platform, "win32", "Core release smoke must run on Windows");
registerPrivilegedSchemes(protocol);
app.setPath("userData", path.join(tempRoot, "electron-user-data"));
// Keep the measurement alive while hidden product windows are torn down; the
// harness exits explicitly only after supervisor and port cleanup completes.
app.on("window-all-closed", () => {});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function powershellJson(command) {
  return run("powershell", ["-NoProfile", "-Command", command]);
}

function readProcessRows() {
  const source = powershellJson(
    "$rows = Get-CimInstance Win32_Process | ForEach-Object { " +
      "[pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; " +
      "workingSetBytes=[double]$_.WorkingSetSize; name=[string]$_.Name } }; " +
      "$rows | ConvertTo-Json -Compress",
  );
  return normalizeProcessRows(source);
}

function readGpuSamples() {
  const source = powershellJson(
    "$samples = (Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage' -ErrorAction Stop).CounterSamples | " +
      "ForEach-Object { [pscustomobject]@{ instanceName=[string]$_.InstanceName; bytes=[double]$_.CookedValue } }; " +
      "$samples | ConvertTo-Json -Compress",
  );
  return normalizeGpuSamples(source);
}

function readGpuInfo() {
  const line = run("nvidia-smi", [
    "--query-gpu=index,name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
  ])
    .split(/\r?\n/)
    .find(Boolean);
  if (!line) throw new Error("nvidia-smi returned no GPU inventory");
  const [index, name, totalMemoryMiB, driver] = line.split(",").map((value) => value.trim());
  assert.equal(Number.isFinite(Number(totalMemoryMiB)), true, "GPU memory total is unavailable");
  return { index: Number(index), name, totalMemoryMiB: Number(totalMemoryMiB), driver };
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function assertCanonicalPortsFree() {
  for (const [name, port] of Object.entries(ports)) {
    assert.equal(await isPortOpen(port), false, `${name} port ${port} is already in use`);
  }
}

async function waitForPortsReleased(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(Object.values(ports).map((port) => isPortOpen(port)));
    if (states.every((open) => !open)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function prepareRuntimeEnvironment() {
  const env = { ...process.env };
  loadManaConfig({ env, repoRoot });
  for (const capability of OPTIONAL_CAPABILITIES) env[capability.flag] = "0";
  Object.assign(env, {
    MANA_PROFILE: "core",
    MANA_ALLOW_REMOTE_AI: "0",
    MANA_ALLOW_REMOTE_ACCESS: "0",
    MANA_BACKEND_HOST: "127.0.0.1",
    MANA_BACKEND_URL: `http://127.0.0.1:${ports.backend}`,
    KOKORO_TTS_URL: `http://127.0.0.1:${ports.kokoro}`,
    LLAMA_SERVER_PORT: String(ports.llama),
    LLAMA_SERVER_IDLE_MS: "0",
    LLAMA_SERVER_STARTUP_TIMEOUT_MS: "180000",
    MANA_LLAMA_SERVER: "1",
    MANA_START_KOKORO: "1",
    TTS_PROVIDER: "kokoro",
    KOKORO_TTS_FALLBACK_PROVIDER: "none",
    WHISPER_LANGUAGE: "en",
    WHISPER_PROMPT: "Mana release validation is ready.",
    NODE_ENV: "production",
    MANA_CONFIG_FILE: path.join(tempRoot, "missing.env"),
    MANA_DATA_DIR: path.join(tempRoot, "data"),
    MANA_ACP_MEMORY_DIR: path.join(tempRoot, "data", "acp-memory"),
    MOBILE_MEMORY_DIR: path.join(tempRoot, "data", "mobile"),
    VECTOR_STORE_DIR: path.join(tempRoot, "data", "vector-store"),
    SCREEN_OCR_CACHE_PATH: path.join(tempRoot, "data", "ocr-cache"),
  });
  delete env.OPENAI_API_KEY;
  return env;
}

function requireRuntimeAssets(env) {
  const assets = {
    llamaBin: env.LLAMA_BIN,
    llamaServerBin: env.LLAMA_SERVER_BIN,
    llamaModel: env.LLAMA_MODEL,
    whisperBin: env.WHISPER_BIN,
    whisperModel: env.WHISPER_MODEL,
    kokoroPython: path.join(repoRoot, "tts-service", "venv", "Scripts", "python.exe"),
    kokoroModel: path.join(repoRoot, "tts-service", "kokoro", "kokoro-v1.0.int8.onnx"),
    kokoroVoices: path.join(repoRoot, "tts-service", "kokoro", "voices-v1.0.bin"),
  };
  for (const [name, filePath] of Object.entries(assets)) {
    assert.ok(filePath, `${name} is not configured`);
    assert.equal(fs.existsSync(filePath), true, `${name} is missing: ${filePath}`);
  }
  assert.ok(fs.statSync(assets.llamaModel).size > 1024 * 1024, "Llama model is not a real model file");
  assert.ok(fs.statSync(assets.whisperModel).size > 1024 * 1024, "Whisper model is not a real model file");
  return Object.fromEntries(
    Object.entries(assets).map(([name, filePath]) => [
      name,
      {
        path: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
        bytes: fs.statSync(filePath).size,
      },
    ]),
  );
}

function configureSupervisor(env) {
  const plan = createLauncherServicePlan({
    repoRoot,
    env,
    command:
      resolveBundledNode({
        env,
        repoRoot,
        resourcesPath: process.resourcesPath,
      }) || "node",
    dataDir: env.MANA_DATA_DIR,
  });
  assert.deepEqual(plan.warnings, [], "Core launcher plan must have no warnings");
  assert.deepEqual(plan.descriptors.map((descriptor) => descriptor.id), ["backend", "kokoro"]);
  for (const descriptor of plan.descriptors) {
    supervisor.register({ ...descriptor, allowExisting: false });
  }
}

async function createProductWindows() {
  installLocalProtocols({ protocol, net: electronNet, appRoot: launcherRoot });
  ipcMain.handle(IPC_CHANNELS.RENDERER_CONFIG, () => ({ silenceBufferMs: 2200 }));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const specifications = [
    {
      url: `${APP_ORIGIN}/renderer/index.html`,
      preload: path.join(launcherRoot, "preload.js"),
      width: 1020,
      height: 720,
    },
    {
      url: `${APP_ORIGIN}/avatar/index.html`,
      preload: path.join(launcherRoot, "avatar-preload.js"),
      width: 234,
      height: 288,
      transparent: true,
    },
  ];
  await Promise.all(
    specifications.map(async (specification) => {
      const window = new BrowserWindow({
        width: specification.width,
        height: specification.height,
        show: false,
        transparent: specification.transparent === true,
        webPreferences: {
          preload: specification.preload,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      window.webContents.setAudioMuted(true);
      windows.push(window);
      await window.loadURL(specification.url);
    }),
  );
}

async function fetchResponse(url, options = {}, timeoutMs = 240000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${url} failed (${response.status}): ${body.slice(0, 1000)}`);
  }
  return response;
}

async function postJson(baseUrl, route, body) {
  const response = await fetchResponse(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function writeEvidence(evidence) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function exerciseProviders(baseUrl) {
  await postJson(baseUrl, "/reply", {
    text: "Reply briefly that the local Mana core is warming up.",
    includeContext: false,
  });

  const textStartedAt = Date.now();
  const replyPayload = await postJson(baseUrl, "/reply", {
    text: "Reply briefly that the local Mana core is ready.",
    includeContext: false,
  });
  const warmTextLatencyMs = Date.now() - textStartedAt;

  const phrase = "Mana release validation is ready.";
  const ttsStartedAt = Date.now();
  const ttsResponse = await fetchResponse(`${baseUrl}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: phrase }),
  });
  const audio = Buffer.from(await ttsResponse.arrayBuffer());
  const ttsLatencyMs = Date.now() - ttsStartedAt;

  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "core-release.wav");
  const sttStartedAt = Date.now();
  const transcriptResponse = await fetchResponse(`${baseUrl}/transcribe-only`, {
    method: "POST",
    body: form,
  });
  const transcriptPayload = await transcriptResponse.json();
  const sttLatencyMs = Date.now() - sttStartedAt;

  const normalized = assertLocalProviderResults({
    reply: replyPayload.reply,
    transcript: transcriptPayload.transcript,
    audio,
  });
  return {
    metrics: { warmTextLatencyMs, sttLatencyMs, ttsLatencyMs },
    proof: {
      localLlm: true,
      localWhisper: true,
      localKokoro: true,
      replyLength: normalized.reply.length,
      replySha256: hashText(normalized.reply),
      transcript: normalized.transcript,
      synthesizedAudioBytes: audio.length,
      synthesizedPhrase: phrase,
    },
  };
}

async function measure() {
  const env = prepareRuntimeEnvironment();
  const assets = requireRuntimeAssets(env);
  const gpu = readGpuInfo();
  const budgets = JSON.parse(fs.readFileSync(path.join(repoRoot, "quality", "budgets.json"), "utf8"));
  await assertCanonicalPortsFree();
  configureSupervisor(env);

  let evidence;
  let primaryError = null;
  let ownedPids = [];
  try {
    const startedAt = Date.now();
    const [states] = await Promise.all([supervisor.startAll(), createProductWindows()]);
    const coldStartMs = Date.now() - startedAt;
    assert.ok(Object.values(states).every((state) => state.status === "ready" && state.owned));
    ownedPids = Object.values(states).map((state) => state.pid).filter(Boolean);

    const providerResult = await exerciseProviders(env.MANA_BACKEND_URL);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const resources = summarizeRuntimeResources({
      processRows: readProcessRows(),
      gpuSamples: readGpuSamples(),
      rootPid: process.pid,
    });
    const names = resources.processes.map((entry) => entry.name.toLowerCase());
    assert.ok(names.some((name) => name === "electron.exe"), "Electron shell process is missing");
    assert.ok(names.some((name) => name === "node.exe"), "backend Node process is missing");
    assert.ok(names.some((name) => name === "python.exe"), "Kokoro Python process is missing");
    assert.ok(names.some((name) => name === "llama-server.exe"), "llama-server process is missing");

    evidence = {
      schemaVersion: 1,
      profile: "coreRelease",
      measuredAt: new Date().toISOString(),
      machine: {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
        cpu: os.cpus()[0]?.model?.trim() || "unknown",
        totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
        gpu,
      },
      configuration: {
        startupPath: "windows-launcher -> node-bot -> Whisper / llama.cpp / Kokoro",
        profile: env.MANA_PROFILE,
        remoteAiEnabled: false,
        ttsProvider: env.TTS_PROVIDER,
        backendUrl: env.MANA_BACKEND_URL,
        kokoroUrl: env.KOKORO_TTS_URL,
        llamaServerPort: Number(env.LLAMA_SERVER_PORT),
        modelAssets: assets,
      },
      metrics: {
        processCount: resources.processCount,
        idleRamMb: resources.idleRamMb,
        idleVramMb: resources.idleVramMb,
        coldStartMs,
        ...providerResult.metrics,
      },
      processInventory: resources.processes,
      providerProof: providerResult.proof,
      measurementMethods: {
        ram: "Win32_Process.WorkingSetSize summed for the Electron process tree",
        vram: "GPU Process Memory Dedicated Usage summed for the same process-tree PIDs",
        latency: "wall-clock milliseconds around readiness and real loopback API requests",
      },
      shutdown: {
        allServicesStopped: false,
        allPortsReleased: false,
        descendantProcessesRemaining: null,
      },
      budgets: null,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    for (const window of windows.splice(0)) {
      if (!window.isDestroyed()) window.destroy();
    }
    try {
      await supervisor.stopAll();
    } catch (error) {
      primaryError = primaryError || error;
    }
    const allPortsReleased = await waitForPortsReleased();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const remainingRows = readProcessRows();
    const remainingOwnedTrees = ownedPids.flatMap((pid) => collectProcessTree(remainingRows, pid));
    if (evidence) {
      evidence.shutdown = {
        allServicesStopped: Object.values(supervisor.getStates()).every(
          (state) => state.status === "stopped" && state.owned === false,
        ),
        allPortsReleased,
        descendantProcessesRemaining: remainingOwnedTrees.length,
      };
    }
  }

  if (primaryError) throw primaryError;
  validateCoreReleaseEvidence(evidence);
  try {
    evidence.budgets = {
      status: "pass",
      results: checkCoreReleaseBudgets({ budgets, evidence }),
    };
  } catch (error) {
    evidence.budgets = { status: "fail", error: error.message };
    writeEvidence(evidence);
    throw error;
  }
  writeEvidence(evidence);
  process.stdout.write(`${JSON.stringify({ metrics: evidence.metrics, shutdown: evidence.shutdown })}\n`);
}

app.whenReady()
  .then(measure)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
