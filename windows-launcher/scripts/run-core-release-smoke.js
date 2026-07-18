const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const electron = require("electron");
const { validateCoreReleaseEvidence } = require("../../scripts/core-release-evidence");

const repoRoot = path.resolve(__dirname, "..", "..");

function parseOutput(args) {
  const index = args.indexOf("--output");
  if (index === -1) return path.join(repoRoot, "quality", "core-release-evidence.json");
  if (!args[index + 1]) throw new TypeError("--output requires a file path");
  if (args.length !== 2) throw new TypeError("Only --output <path> is supported");
  return path.resolve(args[index + 1]);
}

function terminateTree(pid) {
  if (!pid || process.platform !== "win32") return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function main(args = process.argv.slice(2)) {
  if (process.platform !== "win32") {
    throw new Error("Core release evidence must be measured on Windows.");
  }
  const output = parseOutput(args);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(output, { force: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mana-core-release-"));

  const env = {
    ...process.env,
    MANA_CORE_RELEASE_EVIDENCE_FILE: output,
    MANA_CORE_RELEASE_TEMP_DIR: tempRoot,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  try {
    const child = spawn(electron, [path.join(__dirname, "core-release-smoke.js")], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        terminateTree(child.pid);
        reject(new Error("Core release measurement timed out after 10 minutes."));
      }, 10 * 60 * 1000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        if (signal) {
          reject(new Error(`Core release measurement exited on signal ${signal}.`));
          return;
        }
        resolve(code);
      });
    });

    if (exitCode !== 0) throw new Error(`Core release measurement exited with code ${exitCode}.`);
    if (!fs.existsSync(output)) throw new Error(`Core release evidence was not written: ${output}`);
    const evidence = JSON.parse(fs.readFileSync(output, "utf8"));
    validateCoreReleaseEvidence(evidence);
    process.stdout.write(`Core release evidence passed: ${output}\n`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, parseOutput };
