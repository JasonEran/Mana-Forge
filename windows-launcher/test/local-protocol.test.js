const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { appPathAllowed, resolveProtocolPath } = require("../local-protocol");

test("app protocol exposes only renderer runtime assets", () => {
  assert.equal(appPathAllowed("renderer/index.html"), true);
  assert.equal(appPathAllowed("avatar/ring-visualizer.js"), true);
  assert.equal(appPathAllowed("avatar/renderer.js"), true);
  assert.equal(appPathAllowed("assets/avatar/portrait.png"), false);
  assert.equal(appPathAllowed("node_modules/renderer.js"), false);
  assert.equal(appPathAllowed("main.js"), false);
  assert.equal(appPathAllowed("preload.js"), false);
  assert.equal(appPathAllowed("avatar/model/Mana.model3.json"), false);
  assert.equal(appPathAllowed("test/electron-security.test.js"), false);
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
