const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(repoRoot, "node-bot");
const defaultOutput = path.join(repoRoot, "quality", "capability-profiles.json");

function directorySize(root) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else total += fs.statSync(absolute).size;
    }
  }
  return total;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function measureInstall(profile, tempRoot) {
  const target = path.join(tempRoot, profile);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(packageRoot, "package.json"), path.join(target, "package.json"));
  fs.copyFileSync(
    path.join(packageRoot, "package-lock.json"),
    path.join(target, "package-lock.json"),
  );
  const npmArgs = ["ci", "--ignore-scripts", "--no-audit", "--progress=false"];
  if (profile === "core") npmArgs.push("--omit=optional");
  if (process.platform === "win32") {
    run(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd", ...npmArgs], {
      cwd: target,
      timeout: 180_000,
    });
  } else {
    run("npm", npmArgs, { cwd: target, timeout: 180_000 });
  }
  return Math.round((directorySize(path.join(target, "node_modules")) / 1024 / 1024) * 10) / 10;
}

function measureLifecycle(profile) {
  const output = run(
    process.execPath,
    [path.join(__dirname, "capability-profile-child.js"), profile],
    { cwd: repoRoot, timeout: 120_000 },
  );
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("MANA_PROFILE_EVIDENCE="));
  if (!line) throw new Error(`Missing ${profile} lifecycle evidence: ${output}`);
  return JSON.parse(line.slice("MANA_PROFILE_EVIDENCE=".length));
}

function main(args = process.argv.slice(2)) {
  const outputIndex = args.indexOf("--output");
  const output =
    outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : defaultOutput;
  if (outputIndex >= 0 && !args[outputIndex + 1]) {
    throw new TypeError("--output requires a file path");
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mana-profile-installs-"));
  try {
    const core = measureLifecycle("core");
    const full = measureLifecycle("full");
    core.dependencyDiskMiB = measureInstall("core", tempRoot);
    full.dependencyDiskMiB = measureInstall("full", tempRoot);
    const evidence = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      machine: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpu: os.cpus()[0]?.model?.trim() || "unknown",
        totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
      },
      profiles: { core, full },
      delta: {
        dependencyDiskMiB: Math.round((full.dependencyDiskMiB - core.dependencyDiskMiB) * 10) / 10,
        rssMb: Math.round((full.rssMb - core.rssMb) * 10) / 10,
        coldStartMs: full.coldStartMs - core.coldStartMs,
        processCount: full.processCount - core.processCount,
        vramMb:
          core.vramMb === null || full.vramMb === null
            ? null
            : full.vramMb - core.vramMb,
      },
      notes: [
        "Lifecycle measurements cover the local backend composition; desktop shell, model, STT, and TTS process budgets remain governed by quality/budgets.json.",
        "A null VRAM value means nvidia-smi was unavailable. No model process was started by this profile probe.",
      ],
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) main();

module.exports = { directorySize, measureInstall, measureLifecycle };
