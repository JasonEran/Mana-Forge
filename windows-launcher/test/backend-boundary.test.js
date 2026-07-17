const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("the supported renderer uses the IPv4 loopback backend boundary", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "renderer", "renderer.js"),
    "utf8",
  );
  const backendUrls = source.match(/http:\/\/[^"'`]+:5005/g) || [];

  assert.ok(backendUrls.length > 5, "renderer backend URL inventory shrank");
  assert.equal(
    backendUrls.every((url) => url.startsWith("http://127.0.0.1:5005")),
    true,
  );
  assert.doesNotMatch(source, /http:\/\/localhost:5005/);
});

test("renderers contain no Node or raw Electron access", () => {
  for (const relativePath of [
    "renderer/renderer.js",
    "avatar/renderer.js",
    "avatar/live2d-avatar.js",
  ]) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", relativePath),
      "utf8",
    );
    assert.doesNotMatch(source, /\brequire\s*\(/, relativePath);
    assert.doesNotMatch(source, /\bprocess\s*\./, relativePath);
    assert.doesNotMatch(source, /\bipcRenderer\b/, relativePath);
  }
});

test("renderer emotion states cross the validated avatar boundary", () => {
  const securitySource = fs.readFileSync(
    path.join(__dirname, "..", "electron-security.js"),
    "utf8",
  );
  const avatarSource = fs.readFileSync(
    path.join(__dirname, "..", "avatar", "renderer.js"),
    "utf8",
  );

  for (const state of ["idle", "talking", "excited", "angry", "sad", "disgusted"]) {
    assert.match(securitySource, new RegExp(`"${state}"`), state);
    assert.match(avatarSource, new RegExp(`\\b${state}:`), state);
  }
});

test("both windows opt into the hardened Electron web preferences", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.equal((source.match(/nodeIntegration:\s*false/g) || []).length, 2);
  assert.equal((source.match(/contextIsolation:\s*true/g) || []).length, 2);
  assert.equal((source.match(/sandbox:\s*true/g) || []).length, 2);
});

test("both local documents declare a restrictive CSP", () => {
  for (const relativePath of ["renderer/index.html", "avatar/index.html"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    assert.match(source, /Content-Security-Policy/);
    assert.match(source, /default-src 'none'/);
    assert.match(source, /object-src 'none'/);
    assert.doesNotMatch(source, /script-src[^;]*'unsafe-eval'/);
    assert.doesNotMatch(source, /script-src[^;]*https?:/);
  }
});

test("the launcher loads only the restricted application protocol", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /loadURL\(MAIN_DOCUMENT_URL\)/);
  assert.match(source, /loadURL\(AVATAR_DOCUMENT_URL\)/);
  assert.doesNotMatch(source, /\.loadFile\s*\(/);
  assert.doesNotMatch(source, /file:\/\//);
  assert.ok(
    source.indexOf("installLocalProtocols({") < source.indexOf("createWindow();"),
    "custom protocols must be installed before either window loads",
  );
  assert.equal((source.match(/installLocalProtocols\s*\(\{/g) || []).length, 1);
});

test("packaged launcher excludes development tests and scripts", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  assert.ok(manifest.build.files.includes("!test{,/**}"));
  assert.ok(manifest.build.files.includes("!scripts{,/**}"));
  assert.ok(manifest.build.files.includes("!nodemon.json"));
});

test("main process installs navigation, permission, and validated IPC policies", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(source, /webContents\.on\("will-navigate"/);
  assert.match(source, /webContents\.on\("will-redirect"/);
  assert.match(source, /setPermissionCheckHandler\(/);
  assert.match(source, /setPermissionRequestHandler\(/);
  assert.doesNotMatch(source, /ipcMain\.(?:on|handle)\(\s*["']/);

  const registrations = source.match(/ipcMain\.(?:on|handle)\(IPC_CHANNELS\.[A-Z_]+/g) || [];
  assert.equal(registrations.length, 6);
  const senderChecks = source.match(/isTrustedSender\s*\(/g) || [];
  assert.ok(senderChecks.length >= 6, "every renderer-to-main path must validate its sender");
});
