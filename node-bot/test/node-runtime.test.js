const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  nodeBinaryName,
  resolveBundledNode,
} = require("../../runtime/node-runtime");

test("bundled Node resolver uses platform-specific executable names", () => {
  assert.equal(nodeBinaryName("win32"), "node.exe");
  assert.equal(nodeBinaryName("linux"), "bin/node");
});

test("bundled Node resolver prefers an explicit binary", () => {
  const explicit = path.join("C:\\Mana", "node.exe");
  const found = resolveBundledNode({
    platform: "win32",
    env: { MANA_NODE_BIN: explicit },
    fs: { existsSync: (candidate) => candidate === explicit },
    resourcesPath: "C:\\Resources",
    repoRoot: "C:\\Mana",
  });

  assert.equal(found, explicit);
});

test("bundled Node resolver checks packaged resources before development copies", () => {
  const resourceNode = path.join("/opt/mana/resources", "node_bin", "bin/node");
  const found = resolveBundledNode({
    platform: "linux",
    env: {},
    fs: { existsSync: (candidate) => candidate === resourceNode },
    resourcesPath: "/opt/mana/resources",
    repoRoot: "/opt/mana",
  });

  assert.equal(found, resourceNode);
});

test("bundled Node resolver returns null when no staged runtime exists", () => {
  assert.equal(
    resolveBundledNode({
      platform: "win32",
      env: {},
      fs: { existsSync: () => false },
      resourcesPath: "C:\\Resources",
      repoRoot: "C:\\Mana",
    }),
    null,
  );
});
