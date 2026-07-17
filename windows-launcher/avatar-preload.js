const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback, normalize) {
  if (typeof callback !== "function") throw new TypeError("Callback is required.");
  const listener = (_event, value) => callback(normalize(value));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld(
  "manaAvatar",
  Object.freeze({
    getBootstrap: () => ipcRenderer.invoke("avatar:get-bootstrap"),
    onMouth: (callback) =>
      subscribe("avatar:mouth", callback, (value) =>
        Math.max(0, Math.min(1, Number(value) || 0)),
      ),
    onState: (callback) =>
      subscribe("avatar:state", callback, (value) => String(value || "idle")),
  }),
);
