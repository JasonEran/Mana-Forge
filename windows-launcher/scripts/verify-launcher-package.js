const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const asar = require("@electron/asar");

const launcherRoot = path.resolve(__dirname, "..");
const distRoot = path.join(launcherRoot, "dist");
const REQUIRED_FILES = Object.freeze([
  "/avatar-preload.js",
  "/avatar/index.html",
  "/avatar/model-loader.js",
  "/electron-security.js",
  "/local-protocol.js",
  "/main.js",
  "/preload.js",
  "/renderer/index.html",
]);
const FORBIDDEN_PATTERNS = Object.freeze([
  /^\/nodemon\.json$/,
  /^\/scripts\//,
  /^\/test\//,
  /\.(?:bin|ckpt|gguf|onnx|pt|pth|safetensors)$/i,
]);
const MODEL_WEIGHT_PATTERN = /\.(?:bin|ckpt|gguf|onnx|pt|pth|safetensors)$/i;
const ELECTRON_RUNTIME_BINARIES = new Set([
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
]);
const REQUIRED_EXTERNAL_FILES = Object.freeze([
  "node-bot/server.js",
  "node-bot/package.json",
  "node-bot/node_modules/express/package.json",
  "runtime/config.js",
  "runtime/services/backend.js",
]);

function listPhysicalFiles(rootDir) {
  const files = [];
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else files.push(absolute);
    }
  }
  return files;
}

function findAsar(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name === "app.asar") return absolute;
    }
  }
  return null;
}

function findUnpackedRoot(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith("-unpacked")) continue;
    const candidate = path.join(rootDir, entry.name);
    if (fs.existsSync(path.join(candidate, "resources"))) return candidate;
  }
  return null;
}

function verifyPackage(asarPath) {
  assert.ok(asarPath, `No app.asar found under ${distRoot}. Run npm run pack first.`);
  const files = asar.listPackage(asarPath).map((file) => file.replace(/\\/g, "/"));
  const fileSet = new Set(files);
  const missing = REQUIRED_FILES.filter((file) => !fileSet.has(file));
  const forbidden = files.filter((file) =>
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(file)),
  );
  const packagedFiles = listPhysicalFiles(distRoot);
  const externalModelWeights = packagedFiles.filter(
    (file) =>
      file !== asarPath &&
      MODEL_WEIGHT_PATTERN.test(file) &&
      !ELECTRON_RUNTIME_BINARIES.has(path.basename(file).toLowerCase()),
  );
  const unpackedRoot = findUnpackedRoot(distRoot);
  const resourcesRoot = unpackedRoot
    ? path.join(unpackedRoot, "resources")
    : null;
  const missingExternal = resourcesRoot
    ? REQUIRED_EXTERNAL_FILES.filter(
        (relativePath) => !fs.existsSync(path.join(resourcesRoot, relativePath)),
      )
    : REQUIRED_EXTERNAL_FILES;
  const bundledNode = resourcesRoot
    ? process.platform === "win32"
      ? path.join(resourcesRoot, "node_bin", "node.exe")
      : path.join(resourcesRoot, "node_bin", "bin", "node")
    : null;
  assert.deepEqual(missing, [], `Packaged security files are missing: ${missing.join(", ")}`);
  assert.deepEqual(forbidden, [], `Forbidden development/model files found: ${forbidden.join(", ")}`);
  assert.deepEqual(
    externalModelWeights,
    [],
    `Model weights found outside ASAR: ${externalModelWeights.join(", ")}`,
  );
  assert.deepEqual(
    missingExternal,
    [],
    `Packaged runtime resources are missing: ${missingExternal.join(", ")}`,
  );
  if (process.env.MANA_REQUIRE_BUNDLED_NODE === "1") {
    assert.ok(
      bundledNode && fs.existsSync(bundledNode),
      `Bundled Node runtime is missing: ${bundledNode || "resources/node_bin/node.exe"}`,
    );
  }

  const asarBytes = fs.statSync(asarPath).size;
  const evidence = {
    appAsar: path.relative(launcherRoot, asarPath).replace(/\\/g, "/"),
    asarBytes,
    asarMiB: Number((asarBytes / 1024 / 1024).toFixed(2)),
    fileCount: files.length,
    forbiddenFiles: forbidden.length,
    modelWeights: 0,
    requiredFiles: `${REQUIRED_FILES.length}/${REQUIRED_FILES.length}`,
    externalResources: `${REQUIRED_EXTERNAL_FILES.length}/${REQUIRED_EXTERNAL_FILES.length}`,
    bundledNode: bundledNode && fs.existsSync(bundledNode) ? "present" : "not-staged",
  };
  if (process.env.MANA_EVIDENCE_FILE) {
    fs.writeFileSync(
      path.resolve(process.env.MANA_EVIDENCE_FILE),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  return evidence;
}

if (require.main === module) verifyPackage(findAsar(distRoot));

module.exports = {
  findAsar,
  findUnpackedRoot,
  listPhysicalFiles,
  verifyPackage,
};
