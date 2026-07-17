const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appPathAllowed,
  avatarPathAllowed,
  resolveProtocolPath,
} = require("../local-protocol");

test("app protocol exposes only renderer runtime assets", () => {
  assert.equal(appPathAllowed("renderer/index.html"), true);
  assert.equal(appPathAllowed("avatar/live2d-avatar.js"), true);
  assert.equal(appPathAllowed("assets/avatar/idle.png"), true);
  assert.equal(appPathAllowed("node_modules/pixi.js/dist/browser/pixi.min.js"), true);
  assert.equal(appPathAllowed("main.js"), false);
  assert.equal(appPathAllowed("preload.js"), false);
  assert.equal(appPathAllowed("avatar/model-loader.js"), false);
  assert.equal(appPathAllowed("avatar/model/Mana.model3.json"), false);
  assert.equal(appPathAllowed("test/electron-security.test.js"), false);
});

test("avatar protocol allows only model asset extensions", () => {
  assert.equal(avatarPathAllowed("Mana.model3.json"), true);
  assert.equal(avatarPathAllowed("textures/texture.png"), true);
  assert.equal(avatarPathAllowed("notes.txt"), false);
  assert.equal(avatarPathAllowed("payload.js"), false);
});

test("protocol path resolution rejects traversal and disallowed files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-protocol-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "renderer"), { recursive: true });
  const index = path.join(root, "renderer", "index.html");
  fs.writeFileSync(index, "ok");
  fs.writeFileSync(path.join(root, "main.js"), "secret");

  assert.equal(
    resolveProtocolPath({
      requestUrl: "mana-app://app/renderer/index.html",
      expectedHost: "app",
      rootDir: root,
      allowedPath: appPathAllowed,
    }),
    fs.realpathSync(index),
  );
  assert.throws(
    () =>
      resolveProtocolPath({
        requestUrl: "mana-app://app/%2e%2e/main.js",
        expectedHost: "app",
        rootDir: root,
        allowedPath: appPathAllowed,
      }),
    /not allowed|escapes/,
  );
  assert.throws(
    () =>
      resolveProtocolPath({
        requestUrl: "mana-app://app/main.js",
        expectedHost: "app",
        rootDir: root,
        allowedPath: appPathAllowed,
      }),
    /not allowed/,
  );
});
