const assert = require("node:assert/strict");

const CORE_RELEASE_METRICS = Object.freeze([
  "processCount",
  "idleRamMb",
  "idleVramMb",
  "coldStartMs",
  "warmTextLatencyMs",
  "sttLatencyMs",
  "ttsLatencyMs",
]);

const MEASUREMENT_HELPERS = new Set([
  "conhost.exe",
  "nvidia-smi.exe",
  "powershell.exe",
  "pwsh.exe",
]);

function asArray(value) {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function parseJsonOutput(source, label) {
  const value = String(source || "").trim();
  if (!value) return [];
  try {
    return asArray(JSON.parse(value));
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function normalizeProcessRows(source) {
  return parseJsonOutput(source, "Windows process inventory")
    .map((row) => ({
      pid: Number(row.pid ?? row.ProcessId),
      parentPid: Number(row.parentPid ?? row.ParentProcessId),
      workingSetBytes: Number(row.workingSetBytes ?? row.WorkingSetSize),
      name: String(row.name ?? row.Name ?? "unknown"),
    }))
    .filter(
      (row) =>
        Number.isInteger(row.pid) &&
        row.pid >= 0 &&
        Number.isInteger(row.parentPid) &&
        Number.isFinite(row.workingSetBytes) &&
        row.workingSetBytes >= 0,
    );
}

function collectProcessTree(rows, rootPid) {
  const normalizedRoot = Number(rootPid);
  assert.ok(Number.isInteger(normalizedRoot) && normalizedRoot > 0, "root PID is required");
  const byParent = new Map();
  for (const row of rows) {
    const children = byParent.get(row.parentPid) || [];
    children.push(row);
    byParent.set(row.parentPid, children);
  }

  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const pending = [normalizedRoot];
  const seen = new Set();
  const tree = [];
  while (pending.length) {
    const pid = pending.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = byPid.get(pid);
    if (row && !MEASUREMENT_HELPERS.has(row.name.toLowerCase())) tree.push(row);
    for (const child of byParent.get(pid) || []) pending.push(child.pid);
  }
  return tree;
}

function normalizeGpuSamples(source) {
  return parseJsonOutput(source, "Windows GPU process memory")
    .map((sample) => {
      const instanceName = String(sample.instanceName ?? sample.InstanceName ?? "");
      const pidMatch = /^pid_(\d+)_/i.exec(instanceName);
      return {
        pid: pidMatch ? Number(pidMatch[1]) : null,
        bytes: Number(sample.bytes ?? sample.CookedValue),
      };
    })
    .filter(
      (sample) =>
        Number.isInteger(sample.pid) &&
        sample.pid > 0 &&
        Number.isFinite(sample.bytes) &&
        sample.bytes >= 0,
    );
}

function roundMiB(bytes) {
  return Math.round((Number(bytes) / 1024 / 1024) * 10) / 10;
}

function summarizeRuntimeResources({ processRows, gpuSamples, rootPid }) {
  const processes = collectProcessTree(processRows, rootPid);
  assert.ok(processes.some((row) => row.pid === Number(rootPid)), "root process is missing");
  const pids = new Set(processes.map((row) => row.pid));
  const gpuByPid = new Map();
  for (const sample of gpuSamples) {
    if (!pids.has(sample.pid)) continue;
    gpuByPid.set(sample.pid, (gpuByPid.get(sample.pid) || 0) + sample.bytes);
  }

  const inventory = processes
    .map((row) => ({
      pid: row.pid,
      parentPid: row.parentPid,
      name: row.name,
      workingSetMiB: roundMiB(row.workingSetBytes),
      dedicatedVramMiB: roundMiB(gpuByPid.get(row.pid) || 0),
    }))
    .sort((left, right) => left.pid - right.pid);

  return {
    processCount: inventory.length,
    idleRamMb: roundMiB(processes.reduce((total, row) => total + row.workingSetBytes, 0)),
    idleVramMb: roundMiB([...gpuByPid.values()].reduce((total, bytes) => total + bytes, 0)),
    processes: inventory,
  };
}

function assertWavBuffer(audio) {
  assert.ok(Buffer.isBuffer(audio), "TTS response must be a Buffer");
  assert.ok(audio.length > 44, "TTS response is too small to be a WAV file");
  assert.equal(audio.subarray(0, 4).toString("ascii"), "RIFF", "WAV RIFF header is missing");
  assert.equal(audio.subarray(8, 12).toString("ascii"), "WAVE", "WAV format marker is missing");
}

function assertLocalProviderResults({ reply, transcript, audio }) {
  const normalizedReply = String(reply || "").trim();
  const normalizedTranscript = String(transcript || "").trim();
  assert.ok(normalizedReply, "local LLM returned an empty reply");
  assert.doesNotMatch(
    normalizedReply,
    /no local llama|local model not found|placeholder reply|\bi heard:\s*$/i,
    "local LLM returned a placeholder",
  );
  assert.ok(normalizedTranscript, "local Whisper returned an empty transcript");
  assertWavBuffer(audio);
  return { reply: normalizedReply, transcript: normalizedTranscript };
}

function validateCoreReleaseEvidence(evidence) {
  assert.equal(evidence?.schemaVersion, 1, "unsupported Core evidence schema");
  assert.equal(evidence?.profile, "coreRelease");
  assert.equal(evidence?.configuration?.remoteAiEnabled, false);
  assert.equal(evidence?.configuration?.ttsProvider, "kokoro");
  for (const metric of CORE_RELEASE_METRICS) {
    assert.equal(Number.isFinite(evidence?.metrics?.[metric]), true, `${metric} is missing`);
    assert.ok(evidence.metrics[metric] >= 0, `${metric} must not be negative`);
  }
  assert.ok(evidence.metrics.processCount > 0, "processCount must be positive");
  assert.ok(evidence.metrics.idleRamMb > 0, "idleRamMb must be positive");
  assert.ok(evidence.metrics.idleVramMb > 0, "target GPU VRAM attribution is missing");
  assert.equal(evidence?.providerProof?.localLlm, true);
  assert.equal(evidence?.providerProof?.localWhisper, true);
  assert.equal(evidence?.providerProof?.localKokoro, true);
  assert.equal(evidence?.shutdown?.allServicesStopped, true);
  assert.equal(evidence?.shutdown?.allPortsReleased, true);
  assert.equal(evidence?.shutdown?.descendantProcessesRemaining, 0);
  return evidence;
}

module.exports = {
  CORE_RELEASE_METRICS,
  assertLocalProviderResults,
  assertWavBuffer,
  collectProcessTree,
  normalizeGpuSamples,
  normalizeProcessRows,
  parseJsonOutput,
  summarizeRuntimeResources,
  validateCoreReleaseEvidence,
};
