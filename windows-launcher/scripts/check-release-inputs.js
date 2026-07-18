const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateReleaseMetadata,
} = require("../../scripts/check-release-metadata");
const { writeManaIcon } = require("./generate-mana-icon");

const repoRoot = path.resolve(__dirname, "..", "..");
const releaseMetadata = validateReleaseMetadata({ repoRoot });
const icon = writeManaIcon(path.join(repoRoot, "windows-launcher", "build", "icon.ico"));
const requiredInputs = [
  "node-bin/node.exe",
  "windows-launcher/build/icon.ico",
  "node-bot/server.js",
  "node-bot/node_modules/express/package.json",
  "runtime/config.js",
  "runtime/services/backend.js",
];
const missing = requiredInputs.filter(
  (relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)),
);

assert.deepEqual(
  missing,
  [],
  `Release inputs are missing: ${missing.join(", ")}. Run backend npm ci and stage the official Node runtime before npm run dist.`,
);
process.stdout.write(
  `${JSON.stringify({
    version: releaseMetadata.version,
    icon: { bytes: icon.bytes, sha256: icon.sha256, sizes: icon.sizes },
    releaseInputs: `${requiredInputs.length}/${requiredInputs.length}`,
  })}\n`,
);
