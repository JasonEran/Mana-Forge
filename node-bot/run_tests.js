const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testDir = path.join(__dirname, "test");

const CORE_TESTS = Object.freeze([
  "backend-architecture.test.js",
  "background-lifecycle.test.js",
  "doctor.test.js",
  "e2e-pairing-smoke.test.js",
  "health-components.test.js",
  "kokoro-service-descriptor.test.js",
  "launcher-service-plan.test.js",
  "mobile-auth.test.js",
  "mobile-device-store.test.js",
  "network-security.test.js",
  "quality-gates.test.js",
  "request-validation.test.js",
  "runtime-config.test.js",
  "runtime-entrypoints.test.js",
  "runtime-supervisor.test.js",
  "server-routes.test.js",
  "speech-routes.test.js",
]);

const OPTIONAL_TESTS = Object.freeze([
  "capabilities-registry.test.js",
  "capability-boundaries.test.js",
  "dir-scanner.test.js",
  "ffxiv-market-capability.test.js",
  "retriever-admin.test.js",
  "tts-runtime.test.js",
  "vtube-runtime.test.js",
  "web-access.test.js",
  "zed-agent-package.test.js",
  "zed-integration.test.js",
]);

function parseTier(args) {
  const value = args.find((arg) => arg.startsWith("--tier="))?.slice(7) || "full";
  if (!["core", "full", "optional"].includes(value)) {
    throw new TypeError(`Unknown test tier "${value}". Use core, full, or optional.`);
  }
  return value;
}

function filesForTier(tier) {
  if (tier === "core") return [...CORE_TESTS];
  if (tier === "optional") return [...OPTIONAL_TESTS];
  return fs
    .readdirSync(testDir)
    .filter((file) => file.endsWith(".test.js"))
    .sort();
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (r.signal) console.error(`Test process terminated by ${r.signal}.`);
    process.exit(r.status ?? 1);
  }
}

function main(args = process.argv.slice(2)) {
  // Test children must never boot background jobs or real model processes.
  process.env.NODE_ENV = "test";
  try {
    os.setPriority(0, 10);
  } catch (_error) {
    // Priority adjustment is best effort outside Windows developer machines.
  }
  const tier = parseTier(args);
  const files = filesForTier(tier);
  for (const file of files) {
    if (!fs.existsSync(path.join(testDir, file))) {
      throw new Error(`Test tier "${tier}" references missing file ${file}.`);
    }
  }

  // Sequential execution keeps peak memory bounded on developer machines and CI.
  console.log(`Running ${files.length} ${tier} test files sequentially`);
  const startedAt = Date.now();
  for (const file of files) {
    const fileStartedAt = Date.now();
    run(process.execPath, ["--test", path.join(testDir, file)], {
      env: { ...process.env, NODE_ENV: "test" },
    });
    console.log(`--- ${file} finished in ${Date.now() - fileStartedAt}ms`);
  }
  console.log(`All ${tier} test files passed in ${Date.now() - startedAt}ms`);
}

if (require.main === module) main();

module.exports = {
  CORE_TESTS,
  OPTIONAL_TESTS,
  filesForTier,
  main,
  parseTier,
};
