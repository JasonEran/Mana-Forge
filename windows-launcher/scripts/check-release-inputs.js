const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const requiredInputs = [
  "node-bin/node.exe",
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
  `${JSON.stringify({ releaseInputs: `${requiredInputs.length}/${requiredInputs.length}` })}\n`,
);
