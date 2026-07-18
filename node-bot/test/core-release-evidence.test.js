const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertLocalProviderResults,
  normalizeGpuSamples,
  normalizeProcessRows,
  summarizeRuntimeResources,
  validateCoreReleaseEvidence,
} = require("../../scripts/core-release-evidence");
const { checkCoreReleaseBudgets } = require("../../scripts/check-quality-budgets");

const budgets = {
  profiles: {
    coreRelease: {
      limits: {
        processCount: 12,
        idleRamMb: 4096,
        idleVramMb: 6144,
        coldStartMs: 180000,
        warmTextLatencyMs: 30000,
        sttLatencyMs: 15000,
        ttsLatencyMs: 15000,
      },
    },
  },
};

function validEvidence() {
  return {
    schemaVersion: 1,
    profile: "coreRelease",
    configuration: { remoteAiEnabled: false, ttsProvider: "kokoro" },
    metrics: {
      processCount: 8,
      idleRamMb: 2048,
      idleVramMb: 3072,
      coldStartMs: 10000,
      warmTextLatencyMs: 5000,
      sttLatencyMs: 3000,
      ttsLatencyMs: 1000,
    },
    providerProof: { localLlm: true, localWhisper: true, localKokoro: true },
    shutdown: {
      allServicesStopped: true,
      allPortsReleased: true,
      descendantProcessesRemaining: 0,
    },
  };
}

test("Core release budgets require every measured field and enforce its ceiling", () => {
  const result = checkCoreReleaseBudgets({ budgets, evidence: validEvidence() });
  assert.deepEqual(Object.keys(result).sort(), Object.keys(budgets.profiles.coreRelease.limits).sort());
  assert.ok(Object.values(result).every((entry) => entry.status === "pass"));

  const overBudget = validEvidence();
  overBudget.metrics.sttLatencyMs = 15001;
  assert.throws(
    () => checkCoreReleaseBudgets({ budgets, evidence: overBudget }),
    /sttLatencyMs.*exceeds budget/,
  );

  const missing = validEvidence();
  delete missing.metrics.idleVramMb;
  assert.throws(
    () => checkCoreReleaseBudgets({ budgets, evidence: missing }),
    /idleVramMb evidence must be finite/,
  );
});

test("Windows process and GPU samples are attributed to one launcher tree", () => {
  const rows = normalizeProcessRows(
    JSON.stringify([
      { pid: 100, parentPid: 1, workingSetBytes: 100 * 1024 * 1024, name: "electron.exe" },
      { pid: 101, parentPid: 100, workingSetBytes: 50 * 1024 * 1024, name: "node.exe" },
      { pid: 102, parentPid: 101, workingSetBytes: 25 * 1024 * 1024, name: "llama-server.exe" },
      { pid: 103, parentPid: 100, workingSetBytes: 10 * 1024 * 1024, name: "powershell.exe" },
      { pid: 999, parentPid: 1, workingSetBytes: 999 * 1024 * 1024, name: "other.exe" },
    ]),
  );
  const gpu = normalizeGpuSamples(
    JSON.stringify([
      { instanceName: "pid_102_luid_0x0_phys_0", bytes: 2 * 1024 * 1024 * 1024 },
      { instanceName: "pid_999_luid_0x0_phys_0", bytes: 9 * 1024 * 1024 * 1024 },
    ]),
  );
  const summary = summarizeRuntimeResources({ processRows: rows, gpuSamples: gpu, rootPid: 100 });
  assert.equal(summary.processCount, 3);
  assert.equal(summary.idleRamMb, 175);
  assert.equal(summary.idleVramMb, 2048);
  assert.deepEqual(summary.processes.map((process) => process.pid), [100, 101, 102]);
});

test("provider proof rejects placeholders, empty transcripts, and invalid audio", () => {
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  assert.deepEqual(
    assertLocalProviderResults({ reply: "Mana core ready.", transcript: "Mana ready", audio: wav }),
    { reply: "Mana core ready.", transcript: "Mana ready" },
  );
  assert.throws(
    () => assertLocalProviderResults({ reply: "(no local llama binary found) I heard: hi", transcript: "ok", audio: wav }),
    /placeholder/,
  );
  assert.throws(
    () => assertLocalProviderResults({ reply: "ok", transcript: "", audio: wav }),
    /empty transcript/,
  );
  assert.throws(
    () => assertLocalProviderResults({ reply: "ok", transcript: "ok", audio: Buffer.from("no") }),
    /too small/,
  );
});

test("complete Core evidence is explicit about providers, telemetry, and shutdown", () => {
  assert.equal(validateCoreReleaseEvidence(validEvidence()).profile, "coreRelease");
  const missingVram = validEvidence();
  missingVram.metrics.idleVramMb = 0;
  assert.throws(() => validateCoreReleaseEvidence(missingVram), /VRAM attribution/);
});

test("published target-machine evidence passes the current Core release budgets", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const publishedEvidence = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "quality", "core-release-evidence.json"), "utf8"),
  );
  const publishedBudgets = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "quality", "budgets.json"), "utf8"),
  );
  validateCoreReleaseEvidence(publishedEvidence);
  const result = checkCoreReleaseBudgets({
    budgets: publishedBudgets,
    evidence: publishedEvidence,
  });
  assert.ok(Object.values(result).every((entry) => entry.status === "pass"));
  assert.equal(publishedEvidence.budgets.status, "pass");
  assert.equal(publishedEvidence.providerProof.transcript.length > 0, true);
});
