const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MobileDeviceStore,
  defaultFilePath,
} = require("../mobile-device-store");

test("mobile device store supports pairing, rotation, and revocation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-devices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new MobileDeviceStore(path.join(root, "devices.json"));

  const { code } = store.generatePairingCode(1);
  assert.equal(typeof code, "string");
  assert.equal(store.consumePairingCode(code), true);
  assert.equal(store.consumePairingCode(code), false);

  const token = `tok-${Math.random()}`;
  const device = store.addDevice({ name: "test-phone", token });
  assert.equal(store.findDeviceByToken(token)?.id, device.id);
  store.updateLastSeen(device.id);
  assert.ok(store.listDevices()[0].lastSeenAt);

  const nextToken = `tok2-${Math.random()}`;
  assert.equal(store.rotateToken(device.id, nextToken), true);
  assert.equal(store.findDeviceByToken(token), null);
  assert.ok(store.findDeviceByToken(nextToken));
  store.revokeDevice(device.id);
  assert.equal(store.findDeviceByToken(nextToken), null);
});

test("MOBILE_MEMORY_DIR isolates the default device store", (t) => {
  const previous = process.env.MOBILE_MEMORY_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-device-config-"));
  t.after(() => {
    if (previous === undefined) delete process.env.MOBILE_MEMORY_DIR;
    else process.env.MOBILE_MEMORY_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.MOBILE_MEMORY_DIR = root;

  const expected = path.join(root, "mobile-devices.json");
  assert.equal(defaultFilePath(), expected);
  const store = new MobileDeviceStore();
  assert.equal(store.filePath, expected);
  assert.equal(fs.existsSync(expected), true);
});
