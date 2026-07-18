const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultBudgetsPath = path.join(repoRoot, "quality", "budgets.json");

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (
      !["--budgets", "--lifecycle", "--package", "--installer"].includes(name)
    ) {
      throw new TypeError(`Unknown argument ${name}.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`${name} requires a file path.`);
    }
    values[name.slice(2)] = path.resolve(value);
    index += 1;
  }
  return values;
}

function readJson(filePath, label) {
  assert.ok(filePath, `${label} evidence path is required.`);
  assert.ok(fs.existsSync(filePath), `${label} evidence is missing: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function checkValue(name, actual, limit) {
  assert.equal(Number.isFinite(actual), true, `${name} evidence must be finite.`);
  assert.ok(actual <= limit, `${name} ${actual} exceeds budget ${limit}.`);
  return { actual, limit, status: "pass" };
}

function checkCiBudgets({
  budgets,
  lifecycle,
  packageEvidence,
  installerEvidence,
}) {
  const limits = budgets?.profiles?.ciLifecycle?.limits;
  assert.ok(limits, "ciLifecycle limits are missing.");
  const actual = {
    ownedProcessCount: lifecycle.ownedProcessCount,
    backendRssMb: lifecycle.backendRssMb,
    coldStartMs: lifecycle.coldStartMs,
    healthLatencyMs: lifecycle.healthLatencyMs,
    localRequestLatencyMs: lifecycle.localRequestLatencyMs,
    packageAsarMiB: packageEvidence.asarMiB,
    installerMiB: installerEvidence.installerMiB,
  };
  return Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => [
      name,
      checkValue(name, actual[name], limit),
    ]),
  );
}

function checkCoreReleaseBudgets({ budgets, evidence }) {
  const limits = budgets?.profiles?.coreRelease?.limits;
  assert.ok(limits, "coreRelease limits are missing.");
  assert.ok(evidence?.metrics, "coreRelease evidence metrics are missing.");
  return Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => [
      name,
      checkValue(name, evidence.metrics[name], limit),
    ]),
  );
}

function main(args = process.argv.slice(2)) {
  const paths = parseArgs(args);
  const budgets = readJson(paths.budgets || defaultBudgetsPath, "budget");
  const lifecycle = readJson(paths.lifecycle, "lifecycle");
  const packageEvidence = readJson(paths.package, "package");
  const installerEvidence = readJson(paths.installer, "installer");
  const results = checkCiBudgets({
    budgets,
    lifecycle,
    packageEvidence,
    installerEvidence,
  });
  process.stdout.write(`${JSON.stringify({ profile: "ciLifecycle", results })}\n`);
}

if (require.main === module) main();

module.exports = {
  checkCiBudgets,
  checkCoreReleaseBudgets,
  checkValue,
  parseArgs,
};
