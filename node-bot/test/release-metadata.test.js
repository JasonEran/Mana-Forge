const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  validateReleaseMetadata,
} = require("../../scripts/check-release-metadata");
const {
  writeInstallerChecksum,
} = require("../../scripts/write-installer-checksum");

const repoRoot = path.resolve(__dirname, "..", "..");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(version = "0.3.0") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-release-"));
  const launcher = {
    version,
    build: {
      artifactName: "Mana-Setup-${version}-${arch}.${ext}",
      win: { target: [{ target: "nsis", arch: ["x64"] }] },
    },
  };
  const backend = { version };
  writeJson(path.join(root, "windows-launcher", "package.json"), launcher);
  writeJson(path.join(root, "windows-launcher", "package-lock.json"), {
    version,
    packages: { "": { version } },
  });
  writeJson(path.join(root, "node-bot", "package.json"), backend);
  writeJson(path.join(root, "node-bot", "package-lock.json"), {
    version,
    packages: { "": { version } },
  });
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), `## [${version}] - 2026-07-18\n\n- Ready.\n`);
  return root;
}

test("repository release metadata is consistently v0.3.0", () => {
  const metadata = validateReleaseMetadata({ repoRoot, tag: "v0.3.0" });
  assert.equal(metadata.version, "0.3.0");
  assert.equal(metadata.expectedInstaller, "Mana-Setup-0.3.0-x64.exe");
  assert.equal(metadata.changelogDate, "2026-07-18");

  const releaseInputs = fs.readFileSync(
    path.join(repoRoot, "windows-launcher", "scripts", "check-release-inputs.js"),
    "utf8",
  );
  assert.match(releaseInputs, /validateReleaseMetadata/);
});

test("release metadata rejects drift, invalid versions, missing changelog, and tag mismatch", (t) => {
  t.test("lockfile drift", () => {
    const root = createFixture();
    const lockPath = path.join(root, "node-bot", "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.packages[""].version = "0.2.0";
    writeJson(lockPath, lock);
    assert.throws(() => validateReleaseMetadata({ repoRoot: root }), /Release version drift/);
  });

  t.test("invalid semantic version", () => {
    const root = createFixture("v0.3");
    assert.throws(() => validateReleaseMetadata({ repoRoot: root }), /invalid release version/);
  });

  t.test("missing changelog entry", () => {
    const root = createFixture();
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "## [Unreleased]\n");
    assert.throws(() => validateReleaseMetadata({ repoRoot: root }), /missing a dated 0\.3\.0/);
  });

  t.test("mismatched tag", () => {
    const root = createFixture();
    assert.throws(
      () => validateReleaseMetadata({ repoRoot: root, tag: "refs/tags/v0.2.0" }),
      /does not match package version/,
    );
  });
});

test("installer checksum is ASCII, reproducible, and bound to the release filename", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mana-installer-"));
  const installer = path.join(tempDir, "Mana-Setup-0.3.0-x64.exe");
  const contents = Buffer.from("deterministic installer fixture");
  fs.writeFileSync(installer, contents);

  const result = writeInstallerChecksum({ repoRoot, installerPath: installer });
  const expectedHash = crypto.createHash("sha256").update(contents).digest("hex");
  assert.equal(result.sha256, expectedHash);
  assert.equal(
    fs.readFileSync(`${installer}.sha256`, "ascii"),
    `${expectedHash} *Mana-Setup-0.3.0-x64.exe\n`,
  );

  const wrongName = path.join(tempDir, "Mana-Setup-latest-x64.exe");
  fs.writeFileSync(wrongName, contents);
  assert.throws(
    () => writeInstallerChecksum({ repoRoot, installerPath: wrongName }),
    /Installer name must be Mana-Setup-0\.3\.0-x64\.exe/,
  );
});
