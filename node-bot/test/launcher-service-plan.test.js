const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createLauncherServicePlan,
} = require("../../runtime/services/launcher");

const repoRoot = path.resolve("C:\\Mana");
const missingFs = { existsSync: () => false };
const installedFs = { existsSync: () => true };

function ids(plan) {
  return plan.descriptors.map((descriptor) => descriptor.id);
}

test("default launcher plan owns only Core services without optional warnings", () => {
  const dataDir = path.join(repoRoot, "user-data");
  const plan = createLauncherServicePlan({
    repoRoot,
    env: {},
    fsImpl: missingFs,
    command: "C:\\Mana\\node_bin\\node.exe",
    dataDir,
  });

  assert.deepEqual(ids(plan), ["backend", "kokoro"]);
  assert.equal(plan.descriptors[0].required, true);
  assert.equal(plan.descriptors[0].command, "C:\\Mana\\node_bin\\node.exe");
  assert.equal(plan.descriptors[0].env.MANA_DATA_DIR, dataDir);
  assert.equal(plan.descriptors[1].required, true);
  assert.deepEqual(plan.warnings, []);
});

test("disabled optional services produce neither descriptors nor warnings", () => {
  const plan = createLauncherServicePlan({
    repoRoot,
    env: { MANA_START_RETRIEVER: "0", MANA_START_SEARXNG: "0" },
    fsImpl: missingFs,
  });

  assert.deepEqual(ids(plan), ["backend", "kokoro"]);
  assert.deepEqual(plan.warnings, []);
});

test("model-free packaged first run can defer Kokoro setup", () => {
  const plan = createLauncherServicePlan({
    repoRoot,
    env: {
      TTS_PROVIDER: "kokoro",
      MANA_START_KOKORO: "0",
      MANA_START_RETRIEVER: "0",
      MANA_START_SEARXNG: "0",
    },
    fsImpl: missingFs,
  });

  assert.deepEqual(ids(plan), ["backend"]);
  assert.deepEqual(plan.warnings, []);
});

test("Chatterbox provider and Kokoro fallback remain optional supervised services", () => {
  const plan = createLauncherServicePlan({
    repoRoot,
    env: {
      TTS_PROVIDER: "chatterbox",
      MANA_ALTERNATE_TTS_ENABLED: "1",
      CHATTERBOX_TTS_URL: "http://127.0.0.1:5510",
      KOKORO_TTS_URL: "http://127.0.0.1:5511",
      MANA_START_RETRIEVER: "0",
      MANA_START_SEARXNG: "0",
    },
    fsImpl: installedFs,
  });

  assert.deepEqual(ids(plan), ["backend", "chatterbox", "kokoro-fallback"]);
  assert.equal(plan.descriptors[1].required, false);
  assert.equal(plan.descriptors[1].healthUrl, "http://127.0.0.1:5510/health");
  assert.equal(plan.descriptors[1].env.CHATTERBOX_PORT, "5510");
  assert.equal(plan.descriptors[2].required, false);
});

test("missing GPT-SoVITS yields one warning and exactly one Kokoro fallback", () => {
  const plan = createLauncherServicePlan({
    repoRoot,
    env: {
      TTS_PROVIDER: "gpt_sovits",
      MANA_ALTERNATE_TTS_ENABLED: "1",
      MANA_START_KOKORO_FALLBACK: "0",
      MANA_START_RETRIEVER: "0",
      MANA_START_SEARXNG: "0",
    },
    fsImpl: missingFs,
  });

  assert.deepEqual(ids(plan), ["backend", "kokoro-fallback"]);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /GPT-SoVITS runtime is missing/);
});

test("installed optional processes are registered as non-required", () => {
  const plan = createLauncherServicePlan({
    repoRoot,
    env: {
      TTS_PROVIDER: "fish",
      MANA_RETRIEVAL_ENABLED: "1",
      MANA_WEB_ACCESS_ENABLED: "1",
      RETRIEVER_HEALTH_URL: "http://127.0.0.1:9000/health",
      SEARXNG_URL: "http://127.0.0.1:8890",
    },
    fsImpl: installedFs,
  });

  assert.deepEqual(ids(plan), ["backend", "retriever", "searxng"]);
  assert.equal(plan.descriptors[1].required, false);
  assert.equal(plan.descriptors[1].env.RETRIEVER_HOST, "127.0.0.1");
  assert.equal(plan.descriptors[1].env.RETRIEVER_PORT, "9000");
  assert.equal(plan.descriptors[2].required, false);
  assert.equal(plan.descriptors[2].healthUrl, "http://127.0.0.1:8890/");
  assert.deepEqual(plan.warnings, []);
});

test("launcher plan rejects remote or credentialed service ownership URLs", () => {
  assert.throws(
    () =>
      createLauncherServicePlan({
        repoRoot,
        env: {
          TTS_PROVIDER: "chatterbox",
          MANA_ALTERNATE_TTS_ENABLED: "1",
          CHATTERBOX_TTS_URL: "http://voice.example.com:5010",
          MANA_START_RETRIEVER: "0",
          MANA_START_SEARXNG: "0",
        },
        fsImpl: installedFs,
      }),
    /CHATTERBOX_TTS_URL must use a loopback host/,
  );
  assert.throws(
    () =>
      createLauncherServicePlan({
        repoRoot,
        env: {
          TTS_PROVIDER: "fish",
          MANA_RETRIEVAL_ENABLED: "1",
          RETRIEVER_HEALTH_URL: "http://user:password@127.0.0.1:9000/health",
        },
        fsImpl: installedFs,
      }),
    /RETRIEVER_HEALTH_URL must not contain credentials/,
  );
});

test("launcher main has no direct child-process lifecycle owner", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "windows-launcher", "main.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /child_process|\bspawn\s*\(|\.kill\s*\(/);
  assert.match(source, /runtimeSupervisor\.startAll\(\)/);
  assert.match(source, /runtimeSupervisor\s*\.stopAll\(\)/);
});
