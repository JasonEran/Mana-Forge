const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("desktop vision capture follows the shared capability profile", () => {
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const renderer = fs.readFileSync(
    path.join(root, "renderer", "renderer.js"),
    "utf8",
  );

  assert.match(main, /isCapabilityEnabled\("vision", process\.env\)/);
  assert.match(main, /if \(!VISION_ENABLED\) return;/);
  assert.match(main, /visionEnabled: VISION_ENABLED/);
  assert.match(main, /Vision capability is disabled\./);
  assert.match(renderer, /let screenContextEnabled = false;/);
  assert.match(renderer, /screenContextEnabled = config\.visionEnabled === true/);
  assert.doesNotMatch(renderer, /SCREEN_CONTEXT_ENABLED = true/);
});
