const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("general server routes do not own FFXIV public route paths", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "server-routes.js"),
    "utf8",
  );

  assert.equal(source.includes('"/ffxiv/market"'), false);
  assert.equal(source.includes('"/ffxiv/crafting/profit"'), false);
  assert.equal(source.includes('"/ffxiv/market/from-screen"'), false);
});

test("a Core app registers no optional routes or implementation modules", () => {
  const previousProfile = process.env.MANA_PROFILE;
  process.env.MANA_PROFILE = "core";
  try {
    const { createApp } = require("../server");
    const app = createApp({ env: { MANA_PROFILE: "core" } });
    const paths = app._router.stack
      .map((layer) => layer.route?.path)
      .filter(Boolean);
    for (const route of [
      "/screen/read",
      "/vision/describe",
      "/web/search",
      "/ffxiv/market",
      "/market/stock/summary",
      "/mobile/health",
      "/editors/status",
      "/vtube/status",
      "/tools/dir-scan",
    ]) {
      assert.equal(paths.includes(route), false, route);
    }

    const loaded = Object.keys(require.cache);
    for (const moduleName of [
      "tesseract.js",
      "ffxiv-market.js",
      "market-data.js",
      "mobile-routes.js",
      "vtube-studio-client.js",
      "zed-integration.js",
      "acp-memory-store.js",
    ]) {
      assert.equal(
        loaded.some((file) => file.endsWith(moduleName)),
        false,
        moduleName,
      );
    }
  } finally {
    if (previousProfile === undefined) delete process.env.MANA_PROFILE;
    else process.env.MANA_PROFILE = previousProfile;
  }
});

test("Core npm dependencies exclude packages owned by optional capabilities", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );

  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    "cors",
    "express",
    "multer",
    "ws",
  ]);
  assert.deepEqual(Object.keys(packageJson.optionalDependencies).sort(), [
    "axios",
    "esprima",
    "tesseract.js",
  ]);
  assert.equal("uuid" in packageJson.dependencies, false);
});
