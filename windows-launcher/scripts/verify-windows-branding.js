const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  Data,
  NtExecutable,
  NtExecutableResource,
  Resource,
} = require("resedit");
const {
  validateReleaseMetadata,
} = require("../../scripts/check-release-metadata");

const launcherRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(launcherRoot, "..");

function normalizeIconSize(value, fallback) {
  return Number(value) || Number(fallback) || 256;
}

function iconPayload(item) {
  return Buffer.from(item.isRaw() ? item.bin : item.generate());
}

function iconRecord({ width, height, bitCount, item }) {
  const payload = iconPayload(item);
  return {
    width: normalizeIconSize(width, item.width),
    height: normalizeIconSize(height, item.height),
    bitCount: Number(bitCount || item.bitCount || item.bitmapInfo?.bitCount || 0),
    bytes: payload.length,
    sha256: crypto.createHash("sha256").update(payload).digest("hex"),
  };
}

function readIcoRecords(iconPath) {
  const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
  return iconFile.icons
    .map((entry) =>
      iconRecord({
        width: entry.width,
        height: entry.height,
        bitCount: entry.bitCount,
        item: entry.data,
      }),
    )
    .sort((first, second) => first.width - second.width);
}

function readExecutableIconGroups(executablePath) {
  const executable = NtExecutable.from(fs.readFileSync(executablePath));
  const resources = NtExecutableResource.from(executable);
  return Resource.IconGroupEntry.fromEntries(resources.entries).map((group) => {
    const items = group.getIconItemsFromEntries(resources.entries);
    return {
      id: group.id,
      lang: group.lang,
      icons: group.icons
        .map((entry, index) =>
          iconRecord({
            width: entry.width,
            height: entry.height,
            bitCount: entry.bitCount,
            item: items[index],
          }),
        )
        .sort((first, second) => first.width - second.width),
    };
  });
}

function recordKey(record) {
  return `${record.bitCount}:${record.sha256}`;
}

function verifyExecutableBranding({ executablePath, sourceRecords }) {
  assert.ok(fs.existsSync(executablePath), `Branded executable is missing: ${executablePath}`);
  const groups = readExecutableIconGroups(executablePath);
  assert.ok(groups.length > 0, `No Windows icon group found in ${executablePath}`);
  const sourceKeys = new Set(sourceRecords.map(recordKey));
  const matchingGroup = groups.find((group) => {
    const groupKeys = new Set(group.icons.map(recordKey));
    return [...sourceKeys].every((key) => groupKeys.has(key));
  });
  assert.ok(
    matchingGroup,
    `${path.basename(executablePath)} does not contain the generated Mana icon payloads`,
  );
  return {
    executable: path.relative(launcherRoot, executablePath).replace(/\\/g, "/"),
    groupId: matchingGroup.id,
    language: matchingGroup.lang,
    declaredSizes: matchingGroup.icons.map((record) => record.width),
    payloadSizes: sourceRecords.map((record) => record.width),
  };
}

function verifyWindowsBranding({ iconPath, executablePaths } = {}) {
  const metadata = validateReleaseMetadata({ repoRoot });
  const resolvedIcon = path.resolve(iconPath || path.join(launcherRoot, "build", "icon.ico"));
  assert.ok(fs.existsSync(resolvedIcon), `Generated Mana icon is missing: ${resolvedIcon}`);
  const sourceRecords = readIcoRecords(resolvedIcon);
  const expectedSizes = [16, 24, 32, 48, 64, 128, 256];
  assert.deepEqual(sourceRecords.map((record) => record.width), expectedSizes);
  assert.ok(sourceRecords.every((record) => record.bitCount === 32));

  const targets = executablePaths || [
    path.join(launcherRoot, "dist", "win-unpacked", "Mana.exe"),
    path.join(launcherRoot, "dist", metadata.expectedInstaller),
  ];
  const executables = targets.map((executablePath) =>
    verifyExecutableBranding({ executablePath: path.resolve(executablePath), sourceRecords }),
  );
  return {
    icon: path.relative(launcherRoot, resolvedIcon).replace(/\\/g, "/"),
    iconSha256: crypto
      .createHash("sha256")
      .update(fs.readFileSync(resolvedIcon))
      .digest("hex"),
    signing: "disabled-by-config",
    sizes: expectedSizes,
    executables,
  };
}

function main() {
  const result = verifyWindowsBranding();
  if (process.env.MANA_EVIDENCE_FILE) {
    fs.writeFileSync(
      path.resolve(process.env.MANA_EVIDENCE_FILE),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = {
  iconPayload,
  readExecutableIconGroups,
  readIcoRecords,
  verifyExecutableBranding,
  verifyWindowsBranding,
};
