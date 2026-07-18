const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  validateReleaseMetadata,
} = require("../../scripts/check-release-metadata");

const distRoot = path.resolve(__dirname, "..", "dist");
const releaseMetadata = validateReleaseMetadata({
  repoRoot: path.resolve(__dirname, "..", ".."),
});
const installerFiles = fs.existsSync(distRoot)
  ? fs
      .readdirSync(distRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".exe") &&
          !entry.name.toLowerCase().includes("uninstaller"),
      )
      .map((entry) => entry.name)
  : [];

assert.equal(
  installerFiles.length,
  1,
  `Expected exactly one top-level Windows installer, found: ${installerFiles.join(", ")}`,
);
assert.equal(installerFiles[0], releaseMetadata.expectedInstaller);
process.stdout.write(
  `${JSON.stringify({ installer: installerFiles[0], count: installerFiles.length })}\n`,
);
