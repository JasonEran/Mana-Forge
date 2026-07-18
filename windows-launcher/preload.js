const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  avatarMouth: "avatar:set-mouth",
  avatarState: "avatar:set-state",
  openLocalWebUi: "external:open-local-web-ui",
  rendererConfig: "renderer:get-config",
  screenCapturePrimary: "screen:capture-primary",
  visionHotkey: "vision:hotkey",
});

function subscribe(channel, callback) {
  if (typeof callback !== "function") throw new TypeError("Callback is required.");
  const listener = () => callback();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld(
  "manaDesktop",
  Object.freeze({
    capturePrimaryScreen: () => ipcRenderer.invoke(channels.screenCapturePrimary),
    getRendererConfig: () => ipcRenderer.invoke(channels.rendererConfig),
    onVisionHotkey: (callback) => subscribe(channels.visionHotkey, callback),
    openLocalWebUi: () => ipcRenderer.invoke(channels.openLocalWebUi),
    setAvatarMouth: (rms) => ipcRenderer.send(channels.avatarMouth, rms),
    setAvatarState: (state) => ipcRenderer.send(channels.avatarState, state),
  }),
);
