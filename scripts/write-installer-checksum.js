const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { validateReleaseMetadata } = require("./check-release-metadata");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeInstallerChecksum({ repoRoot, installerPath } = {}) {
  const root = path.resolve(repoRoot || path.join(__dirname, ".."));
  const metadata = validateReleaseMetadata({ repoRoot: root });
  const resolvedInstaller = path.resolve(
    installerPath || path.join(root, "windows-launcher", "dist", metadata.expectedInstaller),
  );

  assert.equal(
    path.basename(resolvedInstaller),
    metadata.expectedInstaller,
    `Installer name must be ${metadata.expectedInstaller}`,
  );
  assert.ok(fs.statSync(resolvedInstaller).isFile(), `Installer is missing: ${resolvedInstaller}`);

  const sha256 = sha256File(resolvedInstaller);
  const checksumPath = `${resolvedInstaller}.sha256`;
  const checksumText = `${sha256} *${metadata.expectedInstaller}\n`;
  fs.writeFileSync(checksumPath, checksumText, "ascii");
  assert.equal(fs.readFileSync(checksumPath, "ascii"), checksumText);

  return {
    installer: metadata.expectedInstaller,
    checksum: path.basename(checksumPath),
    sha256,
  };
}

function main() {
  const result = writeInstallerChecksum({ installerPath: process.argv[2] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = { sha256File, writeInstallerChecksum };
