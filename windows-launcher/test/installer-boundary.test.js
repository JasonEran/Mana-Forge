const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const launcherRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(launcherRoot, "package.json"), "utf8"),
);

test("the supported launcher owns the NSIS installer target", () => {
  assert.equal(manifest.build.appId, "com.mana.ai");
  assert.equal(manifest.build.productName, "Mana");
  assert.equal(manifest.build.win.target[0].target, "nsis");
  assert.deepEqual(manifest.build.win.target[0].arch, ["x64"]);
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.include, "build/installer.nsh");
  assert.equal(manifest.scripts.predist, "node scripts/check-release-inputs.js");
});

test("packaged runtime resources have one canonical owner", () => {
  const resources = manifest.build.extraResources.map((entry) => [
    entry.from,
    entry.to,
  ]);
  assert.deepEqual(resources, [
    ["../node-bot", "node-bot"],
    ["../node-bot/node_modules", "node-bot/node_modules"],
    ["../runtime", "runtime"],
    ["../tts-service", "tts-service"],
    ["../node-bin", "node_bin"],
  ]);
  assert.equal(
    manifest.build.extraResources.some((entry) =>
      entry.filter?.some((pattern) =>
        /(?:gguf|onnx|safetensors|\.bin)/i.test(pattern),
      ),
    ),
    false,
    "model weights must remain first-run/unbundled assets",
  );
});

test("NSIS migration preserves autostart cleanup", () => {
  const source = fs.readFileSync(
    path.join(launcherRoot, "build", "installer.nsh"),
    "utf8",
  );
  assert.match(source, /WriteRegStr HKCU/);
  assert.match(source, /DeleteRegValue HKCU/);
  assert.match(source, /Mana\.exe/);
});

test("launcher workflows do not rebuild the retired desktop client", () => {
  const workflows = fs
    .readdirSync(path.resolve(launcherRoot, "..", ".github", "workflows"))
    .filter((file) => file.endsWith(".yml"));
  for (const workflow of workflows) {
    const source = fs.readFileSync(
      path.resolve(launcherRoot, "..", ".github", "workflows", workflow),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /desktop-client[\\/].*(?:dist|electron-builder)/i,
      workflow,
    );
  }
});

test("packaged launcher keeps the shared supervisor and user-data contract", () => {
  const source = fs.readFileSync(path.join(launcherRoot, "main.js"), "utf8");
  assert.match(source, /resolveBundledNode/);
  assert.match(source, /app\.getPath\("userData"\)/);
  assert.match(source, /MANA_DATA_DIR/);
  assert.match(source, /createLauncherServicePlan\(\{/);
  assert.match(source, /runtimeSupervisor\.startAll\(\)/);
  assert.doesNotMatch(source, /child_process|\bspawn\s*\(/);
});
