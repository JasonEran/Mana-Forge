const fs = require("node:fs");
const path = require("node:path");

function nodeBinaryName(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "bin/node";
}

function resolveBundledNode(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fs || fs;
  const platform = options.platform || process.platform;
  const executableName = nodeBinaryName(platform);
  const candidates = [];

  if (env.MANA_NODE_BIN) {
    candidates.push(env.MANA_NODE_BIN);
  }

  if (options.resourcesPath) {
    candidates.push(
      path.join(options.resourcesPath, "node_bin", executableName),
      path.join(options.resourcesPath, "node-bin", executableName),
    );
  }

  if (options.repoRoot) {
    candidates.push(
      path.join(options.repoRoot, "node-bin", executableName),
      path.join(options.repoRoot, "node_bin", executableName),
    );
  }

  return (
    candidates.find((candidate) => candidate && fsImpl.existsSync(candidate)) ||
    null
  );
}

module.exports = {
  nodeBinaryName,
  resolveBundledNode,
};
