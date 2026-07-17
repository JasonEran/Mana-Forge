const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createAcpPathGuard,
  parseAllowedPathList,
} = require("../acp-path-guard");

const fixtureRoot = path.resolve("acp-path-guard-fixtures");
const workspace = path.join(fixtureRoot, "workspace");
const externalRoot = path.join(fixtureRoot, "external");

test("parseAllowedPathList splits Windows semicolon separated roots", () => {
  assert.deepEqual(
    parseAllowedPathList("C:\\ManaAI\\Mana;D:\\Shared", "win32"),
    [path.resolve("C:\\ManaAI\\Mana"), path.resolve("D:\\Shared")],
  );
});

test("path guard allows active workspace files", () => {
  const guard = createAcpPathGuard({
    workspacePath: workspace,
    allowedPaths: "",
  });

  const checked = guard.resolveAllowedPath("node-bot/server.js");

  assert.equal(checked.allowed, true);
  assert.equal(
    checked.fullPath,
    path.resolve(workspace, "node-bot/server.js"),
  );
  assert.equal(checked.rootType, "workspace");
});

test("path guard rejects outside paths by default", () => {
  const guard = createAcpPathGuard({
    workspacePath: workspace,
    allowedPaths: "",
  });

  assert.throws(
    () => guard.resolveAllowedPath(path.join(externalRoot, "note.txt")),
    /path is outside the active workspace and allowed roots/i,
  );
});

test("path guard allows outside paths under configured roots", () => {
  const guard = createAcpPathGuard({
    workspacePath: workspace,
    allowedPaths: externalRoot,
  });

  const checked = guard.resolveAllowedPath(path.join(externalRoot, "note.txt"));

  assert.equal(checked.allowed, true);
  assert.equal(checked.rootType, "allowed");
  assert.equal(checked.rootPath, path.resolve(externalRoot));
});

test("path guard rejects sibling paths with a shared prefix", () => {
  const allowedRoot = path.join(fixtureRoot, "tools");
  const guard = createAcpPathGuard({
    workspacePath: workspace,
    allowedPaths: allowedRoot,
  });

  assert.throws(
    () => guard.resolveAllowedPath(path.join(fixtureRoot, "tools2", "x.js")),
    /path is outside the active workspace and allowed roots/i,
  );
});
