const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPreload(relativePath) {
  const calls = [];
  const exposed = {};
  const listeners = new Map();
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push(["invoke", channel, ...args]);
        return Promise.resolve(channel);
      },
      on(channel, listener) {
        calls.push(["on", channel]);
        listeners.set(channel, listener);
      },
      removeListener(channel, listener) {
        calls.push(["removeListener", channel]);
        if (listeners.get(channel) === listener) listeners.delete(channel);
      },
      send(channel, ...args) {
        calls.push(["send", channel, ...args]);
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  vm.runInNewContext(source, {
    Object,
    String,
    TypeError,
    Math,
    Number,
    require(name) {
      assert.equal(name, "electron");
      return electron;
    },
  });
  return { calls, exposed, listeners };
}

test("main preload maps semantic methods to fixed channels", async () => {
  const { calls, exposed, listeners } = loadPreload("preload.js");
  const api = exposed.manaDesktop;
  assert.deepEqual(Object.keys(api).sort(), [
    "capturePrimaryScreen",
    "getRendererConfig",
    "onVisionHotkey",
    "openLocalWebUi",
    "setAvatarMouth",
    "setAvatarState",
  ]);

  api.setAvatarState("idle");
  api.setAvatarMouth(0.2);
  await api.capturePrimaryScreen();
  await api.getRendererConfig();
  await api.openLocalWebUi();
  let hotkeyCalls = 0;
  const unsubscribe = api.onVisionHotkey(() => hotkeyCalls++);
  listeners.get("vision:hotkey")();
  unsubscribe();

  assert.equal(hotkeyCalls, 1);
  assert.deepEqual(calls, [
    ["send", "avatar:set-state", "idle"],
    ["send", "avatar:set-mouth", 0.2],
    ["invoke", "screen:capture-primary"],
    ["invoke", "renderer:get-config"],
    ["invoke", "external:open-local-web-ui"],
    ["on", "vision:hotkey"],
    ["removeListener", "vision:hotkey"],
  ]);
});

test("avatar preload exposes only validated subscriptions", async () => {
  const { calls, exposed, listeners } = loadPreload("avatar-preload.js");
  const api = exposed.manaAvatar;
  assert.deepEqual(Object.keys(api).sort(), ["onMouth", "onState"]);
  let state;
  let mouth;
  api.onState((value) => {
    state = value;
  });
  api.onMouth((value) => {
    mouth = value;
  });
  listeners.get("avatar:state")(null, "talking");
  listeners.get("avatar:mouth")(null, 5);

  assert.equal(state, "talking");
  assert.equal(mouth, 1);
  assert.deepEqual(calls.slice(0, 2), [
    ["on", "avatar:state"],
    ["on", "avatar:mouth"],
  ]);
});
