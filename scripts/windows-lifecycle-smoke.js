const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { createBackendServiceDescriptor } = require("../runtime/services/backend");
const { RuntimeSupervisor } = require("../runtime/supervisor");

const repoRoot = path.resolve(__dirname, "..");
const repositoryDataDir = path.join(repoRoot, "node-bot", "data");

function snapshotDirectory(rootDir) {
  if (!fs.existsSync(rootDir)) return {};
  const snapshot = {};
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else {
        const relative = path.relative(rootDir, absolute).replace(/\\/g, "/");
        snapshot[relative] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(absolute))
          .digest("hex");
      }
    }
  }
  return snapshot;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  return { response, body };
}

async function main() {
  assert.equal(process.platform, "win32", "lifecycle smoke must run on Windows");
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mana-lifecycle-"));
  const repositoryDataBefore = snapshotDirectory(repositoryDataDir);
  const env = {
    ...process.env,
    LLAMA_BIN: path.join(tempRoot, "missing-llama-cli.exe"),
    LLAMA_MODEL: path.join(tempRoot, "missing-model.gguf"),
    MANA_ALLOW_REMOTE_AI: "0",
    MANA_BACKEND_URL: baseUrl,
    MANA_CONFIG_FILE: path.join(tempRoot, "missing.env"),
    MANA_ACP_MEMORY_DIR: path.join(tempRoot, "acp-memory"),
    MANA_LLAMA_SERVER: "0",
    MOBILE_MEMORY_DIR: path.join(tempRoot, "mobile-memory"),
    NODE_ENV: "test",
    RETRIEVER_HEALTH_DELAY_MS: "1",
    RETRIEVER_HEALTH_RETRIES: "1",
    TTS_PROVIDER: "none",
    VTUBE_STUDIO_ENABLED: "0",
  };
  const descriptor = createBackendServiceDescriptor({
    backendUrl: baseUrl,
    command: process.execPath,
    env,
    repoRoot,
  });
  descriptor.allowExisting = false;
  descriptor.env = {
    ...descriptor.env,
    LLAMA_BIN: env.LLAMA_BIN,
    LLAMA_MODEL: env.LLAMA_MODEL,
    MANA_ALLOW_REMOTE_AI: env.MANA_ALLOW_REMOTE_AI,
    MANA_CONFIG_FILE: env.MANA_CONFIG_FILE,
    MANA_ACP_MEMORY_DIR: env.MANA_ACP_MEMORY_DIR,
    MANA_LLAMA_SERVER: env.MANA_LLAMA_SERVER,
    MOBILE_MEMORY_DIR: env.MOBILE_MEMORY_DIR,
    NODE_ENV: env.NODE_ENV,
    RETRIEVER_HEALTH_DELAY_MS: env.RETRIEVER_HEALTH_DELAY_MS,
    RETRIEVER_HEALTH_RETRIES: env.RETRIEVER_HEALTH_RETRIES,
    TTS_PROVIDER: env.TTS_PROVIDER,
  };

  const supervisor = new RuntimeSupervisor();
  supervisor.register(descriptor);
  const startedAt = Date.now();
  let state;
  try {
    state = await supervisor.start("backend");
    const coldStartMs = Date.now() - startedAt;
    assert.equal(state.status, "ready");
    assert.equal(state.owned, true);
    assert.ok(state.pid > 0);

    const healthStartedAt = Date.now();
    const health = await fetchJson(`${baseUrl}/health`);
    const healthLatencyMs = Date.now() - healthStartedAt;
    assert.equal(health.response.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.components.backend.status, "available");

    const requestStartedAt = Date.now();
    const localRequest = await fetchJson(`${baseUrl}/models/status`);
    const localRequestLatencyMs = Date.now() - requestStartedAt;
    assert.equal(localRequest.response.status, 200);
    assert.equal(typeof localRequest.body.activeProfile, "string");

    const backendProcess = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${state.pid}).WorkingSet64`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(backendProcess.status, 0);
    const backendRssMb = Math.round(Number(backendProcess.stdout.trim()) / 1024 / 1024);

    const evidence = {
      backendPid: state.pid,
      backendRssMb,
      coldStartMs,
      healthLatencyMs,
      localRequestLatencyMs,
      ownedProcessCount: state.owned ? 1 : 0,
      platform: `${process.platform}-${process.arch}`,
      port,
    };
    if (process.env.MANA_EVIDENCE_FILE) {
      fs.writeFileSync(
        path.resolve(process.env.MANA_EVIDENCE_FILE),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } finally {
    try {
      await supervisor.stopAll();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  assert.equal(await isPortOpen(port), false, `port ${port} was not released`);
  assert.deepEqual(
    snapshotDirectory(repositoryDataDir),
    repositoryDataBefore,
    "lifecycle smoke modified repository-local runtime data",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
