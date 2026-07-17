const { loadManaConfig } = require("../runtime/config");
const {
  createLauncherServicePlan,
} = require("../runtime/services/launcher");
const { RuntimeSupervisor } = require("../runtime/supervisor");
const {
  IPC_CHANNELS,
  LOCAL_WEB_UI_URL,
  isAllowedExternalUrl,
  isAllowedMediaPermission,
  isExpectedDocumentUrl,
  isTrustedSender,
  normalizeAvatarState,
  normalizeMouthRms,
  normalizeSilenceBufferMs,
} = require("./electron-security");
const {
  loadAvatarBootstrap,
  resolveAvatarModel,
} = require("./avatar/model-loader");
const {
  APP_ORIGIN,
  installLocalProtocols,
  registerPrivilegedSchemes,
} = require("./local-protocol");

loadManaConfig();

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
} = require("electron");
const path = require("path");

registerPrivilegedSchemes(protocol);

let mainWindow;
let avatarWindow;
const ROOT_DIR = path.join(__dirname, "..");
const HIDE_MAIN_WINDOW_AFTER_STARTUP =
  process.env.HIDE_MAIN_WINDOW_AFTER_STARTUP !== "0";
const AVATAR_SIZE = {
  width: Number(process.env.MANA_AVATAR_WIDTH || 234),
  height: Number(process.env.MANA_AVATAR_HEIGHT || 288),
};
const AVATAR_LEFT = Number(process.env.MANA_AVATAR_LEFT || 782);
const AVATAR_BOTTOM = Number(process.env.MANA_AVATAR_BOTTOM || 0);
const AVATAR_TOP_LEVEL = process.env.MANA_AVATAR_TOP_LEVEL || "screen-saver";
// Global "look at my screen" hotkey; set MANA_VISION_HOTKEY=off to disable.
const VISION_HOTKEY = process.env.MANA_VISION_HOTKEY || "Control+Alt+M";
// Global hotkey that toggles the Mana chat window; set to off to disable.
const WINDOW_HOTKEY = process.env.MANA_WINDOW_HOTKEY || "Control+Alt+Space";
const runtimeSupervisor = new RuntimeSupervisor();
const MAIN_DOCUMENT_URL = `${APP_ORIGIN}/renderer/index.html`;
const AVATAR_DOCUMENT_URL = `${APP_ORIGIN}/avatar/index.html`;

const launcherServicePlan = createLauncherServicePlan({ repoRoot: ROOT_DIR });
for (const descriptor of launcherServicePlan.descriptors) {
  runtimeSupervisor.register(descriptor);
}
for (const warning of launcherServicePlan.warnings) console.warn(warning);

async function startWindowsServices() {
  if (runtimeShutdownStarted) return;
  try {
    await runtimeSupervisor.startAll();
  } catch (error) {
    console.error("Failed to start Node bot:", error);
    throw error;
  }
}

function applyWindowSecurity(window, expectedUrl) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isExpectedDocumentUrl(targetUrl, expectedUrl)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isExpectedDocumentUrl(targetUrl, expectedUrl)) event.preventDefault();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1020,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "Mana",
    show: !HIDE_MAIN_WINDOW_AFTER_STARTUP,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  applyWindowSecurity(mainWindow, MAIN_DOCUMENT_URL);
  mainWindow.loadURL(MAIN_DOCUMENT_URL);
  mainWindow.once("ready-to-show", () => {
    if (HIDE_MAIN_WINDOW_AFTER_STARTUP) {
      // Quick rundown: keep the mic/listening page alive, just hide the chat
      // window; Mana stays on screen as the avatar overlay.
      mainWindow.hide();
      return;
    }

    mainWindow.show();
  });

  // The overlay is Mana's minimized form: it deploys whenever the chat
  // window is hidden or minimized, and retracts when the window is up.
  mainWindow.on("show", syncOverlayVisibility);
  mainWindow.on("hide", syncOverlayVisibility);
  mainWindow.on("minimize", syncOverlayVisibility);
  mainWindow.on("restore", syncOverlayVisibility);

  mainWindow.on("closed", function () {
    mainWindow = null;
    app.quit();
  });
}

function isMainWindowActive() {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized(),
  );
}

function toggleMainWindow(forceShow = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (!forceShow && isMainWindowActive()) {
    mainWindow.hide();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function getAvatarBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  // Quick rundown: these defaults place Mana near the lower-middle-left game UI area.
  // Use MANA_AVATAR_LEFT and MANA_AVATAR_BOTTOM if you need to nudge her later.
  return {
    width: AVATAR_SIZE.width,
    height: AVATAR_SIZE.height,
    x: workArea.x + AVATAR_LEFT,
    y: workArea.y + workArea.height - AVATAR_SIZE.height - AVATAR_BOTTOM,
  };
}

function positionAvatarWindow() {
  if (!avatarWindow) {
    return;
  }

  avatarWindow.setBounds(getAvatarBounds());
}

function showAvatarOverlay() {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    return;
  }

  positionAvatarWindow();
  avatarWindow.show();
  avatarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  avatarWindow.setAlwaysOnTop(true, AVATAR_TOP_LEVEL);
  avatarWindow.moveTop();
  avatarWindow.setIgnoreMouseEvents(true, { forward: true });
}

// Overlay = minimized Mana. Visible exactly when the chat window is not.
function syncOverlayVisibility() {
  if (!avatarWindow || avatarWindow.isDestroyed()) {
    return;
  }
  if (isMainWindowActive()) {
    avatarWindow.hide();
    return;
  }
  showAvatarOverlay();
}

function createAvatarWindow() {
  let avatarShown = false;
  const showAvatarWindow = () => {
    if (!avatarWindow || avatarWindow.isDestroyed()) {
      return;
    }

    avatarShown = true;
    syncOverlayVisibility();
  };

  avatarWindow = new BrowserWindow({
    ...getAvatarBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "avatar-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  applyWindowSecurity(avatarWindow, AVATAR_DOCUMENT_URL);
  avatarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  avatarWindow.setAlwaysOnTop(true, AVATAR_TOP_LEVEL);
  avatarWindow.loadURL(AVATAR_DOCUMENT_URL);
  avatarWindow.once("ready-to-show", showAvatarWindow);
  avatarWindow.webContents.once("did-finish-load", showAvatarWindow);
  setTimeout(() => {
    if (!avatarShown) {
      showAvatarWindow();
    }
  }, 1000);

  avatarWindow.webContents.on("did-fail-load", (event, code, description) => {
    console.error(`Avatar failed to load (${code}): ${description}`);
  });

  avatarWindow.on("closed", () => {
    avatarWindow = null;
  });
}

app.whenReady().then(() => {
  // single instance check
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  installLocalProtocols({
    protocol,
    net,
    appRoot: __dirname,
    avatarRoot: () => resolveAvatarModel({ env: process.env }).modelDir,
  });
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, _requestingOrigin, details) =>
      isAllowedMediaPermission(
        webContents,
        mainWindow?.webContents,
        permission,
        details,
        MAIN_DOCUMENT_URL,
      ),
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isAllowedMediaPermission(
          webContents,
          mainWindow?.webContents,
          permission,
          details,
          MAIN_DOCUMENT_URL,
        ),
      );
    },
  );
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  startWindowsServices()
    .catch((e) => {
      dialog.showErrorBox("Start error", e?.message || String(e));
    });

  createWindow();
  createAvatarWindow();
  createTray();
  registerVisionHotkey();
  registerWindowHotkey();

  screen.on("display-metrics-changed", positionAvatarWindow);
  screen.on("display-added", positionAvatarWindow);
  screen.on("display-removed", positionAvatarWindow);

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
let tray = null;

function createTray() {
  try {
    const icon = createTrayIcon();
    tray = new Tray(icon);
    tray.setToolTip("Mana");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Mana", click: () => toggleMainWindow(true) },
        {
          label: "Minimize to overlay",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.hide();
            }
          },
        },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => toggleMainWindow());
  } catch (error) {
    console.warn(`Tray icon unavailable: ${error.message}`);
  }
}

function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edge = x < 2 || x > 13 || y < 2 || y > 13;
      const diagonal = x === y || x + y === size - 1;
      const offset = (y * size + x) * 4;
      buffer[offset] = edge ? 64 : 124;
      buffer[offset + 1] = edge ? 48 : 92;
      buffer[offset + 2] = edge ? 112 : 220;
      buffer[offset + 3] = edge || diagonal ? 255 : 220;
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

function registerWindowHotkey() {
  const disabled =
    !WINDOW_HOTKEY ||
    WINDOW_HOTKEY === "0" ||
    WINDOW_HOTKEY.toLowerCase() === "off";
  if (disabled) {
    return;
  }

  try {
    const registered = globalShortcut.register(WINDOW_HOTKEY, () => {
      toggleMainWindow();
    });
    if (registered) {
      console.log(`Window hotkey registered: ${WINDOW_HOTKEY}`);
    } else {
      console.warn(
        `Window hotkey ${WINDOW_HOTKEY} could not be registered (already in use by another app?). Set MANA_WINDOW_HOTKEY to change it.`,
      );
    }
  } catch (error) {
    console.warn(`Window hotkey registration failed: ${error.message}`);
  }
}

function registerVisionHotkey() {
  const disabled =
    !VISION_HOTKEY ||
    VISION_HOTKEY === "0" ||
    VISION_HOTKEY.toLowerCase() === "off";
  if (disabled) {
    return;
  }

  try {
    const registered = globalShortcut.register(VISION_HOTKEY, () => {
      // The renderer owns the capture/reply/TTS flow; just poke it.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.VISION_HOTKEY);
      }
    });
    if (registered) {
      console.log(`Vision hotkey registered: ${VISION_HOTKEY}`);
    } else {
      console.warn(
        `Vision hotkey ${VISION_HOTKEY} could not be registered (already in use by another app?). Set MANA_VISION_HOTKEY to change it.`,
      );
    }
  } catch (error) {
    console.warn(`Vision hotkey registration failed: ${error.message}`);
  }
}

ipcMain.on(IPC_CHANNELS.AVATAR_STATE, (event, state) => {
  if (!isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL)) return;
  if (!avatarWindow) {
    return;
  }

  try {
    avatarWindow.webContents.send(
      IPC_CHANNELS.AVATAR_STATE_CHANGED,
      normalizeAvatarState(state),
    );
  } catch (error) {
    console.warn(`Rejected invalid avatar state: ${error.message}`);
  }
});
// Relays speech amplitude from the control window to the avatar for lip sync.
ipcMain.on(IPC_CHANNELS.AVATAR_MOUTH, (event, rms) => {
  if (!isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL)) return;
  if (!avatarWindow) {
    return;
  }
  try {
    avatarWindow.webContents.send(
      IPC_CHANNELS.AVATAR_MOUTH_CHANGED,
      normalizeMouthRms(rms),
    );
  } catch (error) {
    console.warn(`Rejected invalid mouth RMS: ${error.message}`);
  }
});
ipcMain.handle(IPC_CHANNELS.RENDERER_CONFIG, async (event) => {
  if (!isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL)) {
    throw new Error("Untrusted renderer configuration request.");
  }
  return {
    silenceBufferMs: normalizeSilenceBufferMs(process.env.MANA_SILENCE_BUFFER_MS),
  };
});
ipcMain.handle(IPC_CHANNELS.AVATAR_BOOTSTRAP, async (event) => {
  const trustedMain = isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL);
  const trustedAvatar = isTrustedSender(
    event,
    avatarWindow?.webContents,
    AVATAR_DOCUMENT_URL,
  );
  if (!trustedMain && !trustedAvatar) {
    throw new Error("Untrusted avatar bootstrap request.");
  }
  return loadAvatarBootstrap({ env: process.env });
});
ipcMain.handle(IPC_CHANNELS.OPEN_LOCAL_WEB_UI, async (event) => {
  if (!isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL)) {
    throw new Error("Untrusted external-link request.");
  }
  if (!isAllowedExternalUrl(LOCAL_WEB_UI_URL)) {
    throw new Error("External URL is not allowed.");
  }
  await shell.openExternal(LOCAL_WEB_UI_URL);
  return true;
});
ipcMain.handle(IPC_CHANNELS.SCREEN_CAPTURE_PRIMARY, async (event) => {
  if (!isTrustedSender(event, mainWindow?.webContents, MAIN_DOCUMENT_URL)) {
    throw new Error("Untrusted screen capture request.");
  }
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      // Quick rundown: smaller captures make OCR faster and lighter while a game is open.
      width: Math.round(primaryDisplay.size.width * 0.65),
      height: Math.round(primaryDisplay.size.height * 0.65),
    },
  });
  const source =
    sources.find((item) => item.display_id === String(primaryDisplay.id)) ||
    sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("No screen source was available");
  }

  const jpeg = source.thumbnail.toJPEG(75);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
});

app.on("window-all-closed", function () {
  // Quit the app and stop the backend on non-macOS platforms.
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

let runtimeShutdownStarted = false;
app.on("before-quit", (event) => {
  if (runtimeShutdownStarted) return;
  event.preventDefault();
  runtimeShutdownStarted = true;
  runtimeSupervisor
    .stopAll()
    .then(() => app.quit())
    .catch((error) => {
      runtimeShutdownStarted = false;
      console.error("Runtime shutdown failed:", error);
      dialog.showErrorBox(
        "Shutdown error",
        `${error.message}\n\nMana is still running so it does not leave an unmanaged backend process. Resolve the reported process or port conflict, then quit again.`,
      );
    });
});
