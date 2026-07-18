const assert = require("node:assert/strict");
const path = require("node:path");

const { app, BrowserWindow, ipcMain, net, protocol, session } = require("electron");
const {
  APP_ORIGIN,
  installLocalProtocols,
  registerPrivilegedSchemes,
} = require("../local-protocol");

registerPrivilegedSchemes(protocol);

const expectedMainApi = [
  "capturePrimaryScreen",
  "getRendererConfig",
  "onVisionHotkey",
  "openLocalWebUi",
  "setAvatarMouth",
  "setAvatarState",
];
const expectedAvatarApi = ["onMouth", "onState"];

async function loadIsolatedWindow({ documentUrl, preloadPath, bridgeName, expectedApi }) {
  const errors = [];
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true,
    },
  });
  window.webContents.on("console-message", (event) => {
    if (["warning", "error"].includes(event.level)) errors.push(event.message);
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    errors.push(`did-fail-load ${code}: ${description}`);
  });

  await window.loadURL(documentUrl);
  const boundary = await window.webContents.executeJavaScript(`({
    processType: typeof process,
    requireType: typeof require,
    bridgeType: typeof window[${JSON.stringify(bridgeName)}],
    api: Object.keys(window[${JSON.stringify(bridgeName)}] || {}).sort()
  })`);

  assert.deepEqual(boundary, {
    processType: "undefined",
    requireType: "undefined",
    bridgeType: "object",
    api: [...expectedApi].sort(),
  });
  assert.deepEqual(errors, []);
  return { boundary, window };
}

app.whenReady()
  .then(async () => {
    ipcMain.handle("renderer:get-config", () => ({ silenceBufferMs: 2200 }));
    const root = path.resolve(__dirname, "..");
    installLocalProtocols({
      protocol,
      net,
      appRoot: root,
    });
    const backendOrigins = [];
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ["http://127.0.0.1:5005/*"] },
      (details, callback) => {
        backendOrigins.push(
          details.requestHeaders.Origin || details.requestHeaders.origin || null,
        );
        callback({ requestHeaders: details.requestHeaders });
      },
    );
    const mainResult = await loadIsolatedWindow({
      documentUrl: `${APP_ORIGIN}/renderer/index.html`,
      preloadPath: path.join(root, "preload.js"),
      bridgeName: "manaDesktop",
      expectedApi: expectedMainApi,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.ok(backendOrigins.length > 0, "renderer did not attempt its backend health request");
    assert.equal(backendOrigins[0], APP_ORIGIN);
    const avatarResult = await loadIsolatedWindow({
      documentUrl: `${APP_ORIGIN}/avatar/index.html`,
      preloadPath: path.join(root, "avatar-preload.js"),
      bridgeName: "manaAvatar",
      expectedApi: expectedAvatarApi,
    });
    process.stdout.write(
      `${JSON.stringify({
        mainBoundary: mainResult.boundary,
        avatarBoundary: avatarResult.boundary,
        backendOrigin: backendOrigins[0],
        electron: process.versions.electron,
      })}\n`,
    );
    mainResult.window.destroy();
    avatarResult.window.destroy();
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
  });
