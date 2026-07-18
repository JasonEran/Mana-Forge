const { once } = require("node:events");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const profile = process.argv[2];
if (!new Set(["core", "full"]).has(profile)) {
  throw new TypeError("profile must be core or full");
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

function getVramMb(pid) {
  const result = spawnSync(
    "nvidia-smi",
    ["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.split(",").map((value) => value.trim()))
    .filter(([candidate]) => Number(candidate) === pid)
    .reduce((sum, [, memory]) => sum + (Number(memory) || 0), 0);
}

async function closeServer(listener) {
  if (!listener.listening) return;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function main() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `mana-${profile}-profile-`),
  );
  const port = await reservePort();
  Object.assign(process.env, {
    MANA_PROFILE: profile,
    MANA_ALLOW_REMOTE_AI: "0",
    MANA_ALLOW_REMOTE_ACCESS: "0",
    MANA_BACKEND_HOST: "127.0.0.1",
    MANA_BACKEND_URL: `http://127.0.0.1:${port}`,
    MANA_CONFIG_FILE: path.join(tempRoot, "missing.env"),
    MANA_DATA_DIR: tempRoot,
    MANA_LLAMA_SERVER: "0",
    MANA_START_RETRIEVER: profile === "full" ? "1" : "0",
    MANA_START_SEARXNG: profile === "full" ? "1" : "0",
    PORT: String(port),
    RETRIEVER_HEALTH_RETRIES: "1",
    RETRIEVER_HEALTH_DELAY_MS: "1",
    TTS_PROVIDER: "kokoro",
    WHISPER_BIN: "",
    WHISPER_MODEL: "",
    LLAMA_BIN: "",
    LLAMA_MODEL: "",
  });

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes("127.0.0.1:9000/health")) {
      return new Response(
        JSON.stringify({ index_loaded: true, model_loaded: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return originalFetch(url, options);
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(" "));
    originalWarn(...args);
  };

  let listener;
  try {
    const startedAt = Date.now();
    const { startServer } = require("../node-bot/server");
    const { createLauncherServicePlan } = require("../runtime/services/launcher");
    const repoRoot = path.resolve(__dirname, "..");
    const launcherPlan = createLauncherServicePlan({
      env: process.env,
      repoRoot,
    });
    listener = await startServer({ env: process.env });
    if (!listener.listening) await once(listener, "listening");
    const coldStartMs = Date.now() - startedAt;
    const healthResponse = await originalFetch(
      `http://127.0.0.1:${port}/health`,
    );
    const health = await healthResponse.json();
    const resources = process.getActiveResourcesInfo();
    const optionalModuleNames = [
      "tesseract.js",
      "ffxiv-market",
      "market-data",
      "mobile-routes",
      "vtube-studio-client",
      "zed-integration",
      "acp-memory-store",
    ];
    const loadedFiles = Object.keys(require.cache);
    const optionalModulesLoaded = optionalModuleNames.filter((name) =>
      loadedFiles.some((file) => file.includes(name)),
    );

    const evidence = {
      profile,
      coldStartMs,
      rssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      vramMb: getVramMb(process.pid),
      processCount: 1,
      plannedServices: launcherPlan.descriptors.map((service) => service.id),
      launcherWarnings: launcherPlan.warnings.map((warning) =>
        warning.split(repoRoot).join("<repo>"),
      ),
      ports: [port],
      activeResourceCounts: Object.fromEntries(
        [...new Set(resources)].sort().map((name) => [
          name,
          resources.filter((candidate) => candidate === name).length,
        ]),
      ),
      warningCount: warnings.length,
      optionalModulesLoaded,
      capabilityStatuses: Object.fromEntries(
        Object.entries(health.components)
          .filter(([, component]) => "enabled" in component)
          .map(([key, component]) => [key, component.status]),
      ),
    };
    process.stdout.write(`MANA_PROFILE_EVIDENCE=${JSON.stringify(evidence)}\n`);
  } finally {
    console.warn = originalWarn;
    global.fetch = originalFetch;
    if (listener) await closeServer(listener);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
