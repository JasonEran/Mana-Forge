const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const distRoot = path.resolve(__dirname, "..", "dist");
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
assert.match(installerFiles[0], /^Mana-Setup-\d+\.\d+\.\d+-x64\.exe$/i);
process.stdout.write(
  `${JSON.stringify({ installer: installerFiles[0], count: installerFiles.length })}\n`,
);
