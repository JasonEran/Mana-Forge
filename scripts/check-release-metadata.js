const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const INSTALLER_TEMPLATE = "Mana-Setup-${version}-${arch}.${ext}";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read release metadata ${filePath}: ${error.message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function releaseTagFromEnvironment(env = process.env) {
  if (env.MANA_RELEASE_TAG) return env.MANA_RELEASE_TAG;
  if (env.GITHUB_REF_TYPE === "tag") return env.GITHUB_REF_NAME || env.GITHUB_REF || "";
  return "";
}

function normalizeReleaseTag(value) {
  return String(value || "").trim().replace(/^refs\/tags\//, "");
}

function validateReleaseMetadata({ repoRoot, tag } = {}) {
  const root = path.resolve(repoRoot || path.join(__dirname, ".."));
  const launcherManifest = readJson(path.join(root, "windows-launcher", "package.json"));
  const launcherLock = readJson(path.join(root, "windows-launcher", "package-lock.json"));
  const backendManifest = readJson(path.join(root, "node-bot", "package.json"));
  const backendLock = readJson(path.join(root, "node-bot", "package-lock.json"));

  const versions = {
    launcherManifest: launcherManifest.version,
    launcherLock: launcherLock.version,
    launcherLockRoot: launcherLock.packages?.[""]?.version,
    backendManifest: backendManifest.version,
    backendLock: backendLock.version,
    backendLockRoot: backendLock.packages?.[""]?.version,
  };
  for (const [source, version] of Object.entries(versions)) {
    assert.match(String(version || ""), SEMVER_PATTERN, `${source} has an invalid release version`);
  }

  const uniqueVersions = new Set(Object.values(versions));
  assert.equal(
    uniqueVersions.size,
    1,
    `Release version drift: ${Object.entries(versions)
      .map(([source, version]) => `${source}=${version}`)
      .join(", ")}`,
  );
  const version = launcherManifest.version;

  assert.equal(
    launcherManifest.build?.artifactName,
    INSTALLER_TEMPLATE,
    "Launcher artifactName must derive from version, arch, and extension",
  );
  const architectures = launcherManifest.build?.win?.target?.flatMap((target) => target.arch || []) || [];
  assert.ok(architectures.includes("x64"), "Launcher release target must include x64");
  const expectedInstaller = INSTALLER_TEMPLATE.replace("${version}", version)
    .replace("${arch}", "x64")
    .replace("${ext}", "exe");

  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const releaseHeading = new RegExp(
    `^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
    "m",
  );
  const changelogMatch = changelog.match(releaseHeading);
  assert.ok(changelogMatch, `CHANGELOG.md is missing a dated ${version} release entry`);

  const releaseTag = normalizeReleaseTag(tag === undefined ? releaseTagFromEnvironment() : tag);
  if (releaseTag) {
    assert.equal(
      releaseTag,
      `v${version}`,
      `Release tag ${releaseTag} does not match package version ${version}`,
    );
  }

  return {
    version,
    changelogDate: changelogMatch[1],
    expectedInstaller,
    releaseTag: releaseTag || null,
  };
}

function main() {
  const metadata = validateReleaseMetadata();
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (require.main === module) main();

module.exports = {
  INSTALLER_TEMPLATE,
  normalizeReleaseTag,
  releaseTagFromEnvironment,
  validateReleaseMetadata,
};
