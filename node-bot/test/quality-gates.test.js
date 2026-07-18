const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { CORE_TESTS, OPTIONAL_TESTS, parseTier } = require("../run_tests");
const { checkCiBudgets } = require("../../scripts/check-quality-budgets");
const {
  validatePullRequestBody,
} = require("../../scripts/check-pr-contract");

const repoRoot = path.resolve(__dirname, "..", "..");

test("test tiers are explicit and independent of GitHub event variables", () => {
  assert.equal(parseTier([]), "full");
  assert.equal(parseTier(["--tier=core"]), "core");
  assert.equal(parseTier(["--tier=optional"]), "optional");
  assert.throws(() => parseTier(["--tier=fastish"]), /Unknown test tier/);
  assert.ok(CORE_TESTS.length >= 15, "core tier must remain representative");
  assert.ok(OPTIONAL_TESTS.length >= 8, "optional tier must remain representative");
  assert.equal(new Set(CORE_TESTS).size, CORE_TESTS.length);
  assert.equal(new Set(OPTIONAL_TESTS).size, OPTIONAL_TESTS.length);
});

test("one quality workflow owns the required release gates", () => {
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  const workflowNames = fs
    .readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  assert.equal(workflowNames.includes("fast-node-tests.yml"), false);
  assert.equal(workflowNames.includes("heavy-ci.yml"), false);

  const workflow = fs.readFileSync(path.join(workflowsDir, "ci.yml"), "utf8");
  for (const contract of [
    "Backend full suite",
    "Launcher suite",
    "Pull request contract",
    "Windows lifecycle and package",
    "npm run test:full",
    "windows-lifecycle-smoke.js",
    "test:electron-security",
    "npm run dist",
    "verify:package",
    "verify:installer",
    "windows-installer-smoke.ps1",
    "check-quality-budgets.js",
    "upload-artifact@v4",
  ]) {
    assert.match(workflow, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(workflow, /desktop-client|wsl-bot|win-bot/);
  assert.equal(workflowNames.includes("label-on-comment.yml"), false);

  const dco = fs.readFileSync(path.join(workflowsDir, "dco.yml"), "utf8");
  assert.match(dco, /Enforce contribution attestation/);
  assert.doesNotMatch(dco, /non-blocking/);
});

test("resource budgets cover CI and the complete Core release profile", () => {
  const budgets = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "quality", "budgets.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(budgets.profiles.ciLifecycle.limits).sort(), [
    "backendRssMb",
    "coldStartMs",
    "healthLatencyMs",
    "installerMiB",
    "localRequestLatencyMs",
    "ownedProcessCount",
    "packageAsarMiB",
  ]);
  assert.deepEqual(Object.keys(budgets.profiles.coreRelease.limits).sort(), [
    "coldStartMs",
    "idleRamMb",
    "idleVramMb",
    "processCount",
    "sttLatencyMs",
    "ttsLatencyMs",
    "warmTextLatencyMs",
  ]);
  assert.doesNotThrow(() =>
    checkCiBudgets({
      budgets,
      lifecycle: {
        backendRssMb: 100,
        coldStartMs: 1000,
        healthLatencyMs: 10,
        localRequestLatencyMs: 50,
        ownedProcessCount: 1,
      },
      packageEvidence: { asarMiB: 50 },
      installerEvidence: { installerMiB: 150 },
    }),
  );
  assert.throws(
    () =>
      checkCiBudgets({
        budgets,
        lifecycle: {
          backendRssMb: 9999,
          coldStartMs: 1000,
          healthLatencyMs: 10,
          localRequestLatencyMs: 50,
          ownedProcessCount: 1,
        },
        packageEvidence: { asarMiB: 50 },
        installerEvidence: { installerMiB: 150 },
      }),
    /backendRssMb.*exceeds budget/,
  );
});

test("pull request template requires issue, validation, security, and rollback", () => {
  const template = fs.readFileSync(
    path.join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE", "cla_contribution.md"),
    "utf8",
  );
  for (const heading of [
    "## Linked issue",
    "## Validation evidence",
    "## Security impact",
    "## Rollback plan",
  ]) {
    assert.ok(template.includes(heading), heading);
  }

  const valid = [
    "Refs #7",
    "## Validation evidence",
    "- 54 test files passed",
    "## Security impact",
    "No new remote surface.",
    "## Rollback plan",
    "Revert the commit.",
  ].join("\n");
  assert.deepEqual(validatePullRequestBody(valid), []);
  assert.deepEqual(validatePullRequestBody("## Validation evidence\n"), [
    "linked issue",
    "validation evidence",
    "security impact",
    "rollback plan",
  ]);
});
