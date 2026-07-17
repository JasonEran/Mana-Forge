const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertSafeRelativeReference,
  loadAvatarBootstrap,
} = require("../avatar/model-loader");

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

test("avatar bootstrap returns validated model data and whitelisted tuning", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-avatar-secure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelJson = writeJson(root, "model/Mana.model3.json", {
    Version: 3,
    FileReferences: {
      Moc: "Mana.moc3",
      Textures: ["textures/texture_00.png"],
      Motions: { Idle: [{ File: "motions/idle.motion3.json" }] },
    },
  });
  fs.writeFileSync(path.join(root, "model", "Mana.moc3"), "moc");
  fs.mkdirSync(path.join(root, "model", "textures"), { recursive: true });
  fs.writeFileSync(path.join(root, "model", "textures", "texture_00.png"), "png");
  fs.mkdirSync(path.join(root, "model", "motions"), { recursive: true });
  fs.writeFileSync(path.join(root, "model", "motions", "idle.motion3.json"), "{}");
  fs.writeFileSync(path.join(root, "model", "motions", "wave.motion3.json"), "{}");
  writeJson(root, "model/mana-avatar.json", { mouthGain: 12 });
  fs.writeFileSync(path.join(root, "live2dcubismcore.min.js"), "core");

  const result = loadAvatarBootstrap({
    defaultModelDir: path.join(root, "model"),
    live2dCorePath: path.join(root, "live2dcubismcore.min.js"),
    env: {
      MANA_LIVE2D_MODEL: modelJson,
      MANA_LIVE2D_MOUTH_GAIN: "21",
      OPENAI_API_KEY: "must-not-cross",
    },
  });

  assert.equal(result.available, true);
  assert.equal(result.runtimeAvailable, true);
  assert.match(result.modelUrl, /^mana-avatar:\/\/model\//);
  assert.equal(result.avatarConfig.mouthGain, 12);
  assert.equal(result.tuning.MANA_LIVE2D_MOUTH_GAIN, "21");
  assert.equal("OPENAI_API_KEY" in result.tuning, false);
  assert.deepEqual(result.motionFiles, [
    "motions/idle.motion3.json",
    "motions/wave.motion3.json",
  ]);
});

test("avatar bootstrap rejects model asset paths that escape the model root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-avatar-escape-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelJson = writeJson(root, "model/Mana.model3.json", {
    Version: 3,
    FileReferences: {
      Moc: "../outside.moc3",
      Textures: [],
    },
  });

  assert.throws(
    () =>
      loadAvatarBootstrap({
        defaultModelDir: path.join(root, "model"),
        env: { MANA_LIVE2D_MODEL: modelJson },
      }),
    /escapes the model directory/,
  );
});

test("avatar bootstrap rejects missing referenced assets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-avatar-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelJson = writeJson(root, "model/Mana.model3.json", {
    Version: 3,
    FileReferences: { Moc: "missing.moc3", Textures: [] },
  });

  assert.throws(
    () =>
      loadAvatarBootstrap({
        defaultModelDir: path.join(root, "model"),
        env: { MANA_LIVE2D_MODEL: modelJson },
      }),
    /does not exist/,
  );
});

test("avatar model references cannot select remote or absolute resources", () => {
  assert.doesNotThrow(() => assertSafeRelativeReference("textures/texture.png"));
  for (const value of [
    "https://evil.example.test/model.moc3",
    "file:///C:/secret.txt",
    "C:\\secret.txt",
    "/etc/passwd",
    "..\\outside.moc3",
  ]) {
    assert.throws(() => assertSafeRelativeReference(value), /safe relative URLs/);
  }
});

test("avatar bootstrap is unavailable when no model exists", () => {
  assert.deepEqual(
    loadAvatarBootstrap({
      defaultModelDir: path.join(os.tmpdir(), "mana-missing-model"),
      env: {},
    }),
    { available: false },
  );
});
