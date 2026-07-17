const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("the supported renderer uses the IPv4 loopback backend boundary", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "renderer", "renderer.js"),
    "utf8",
  );
  const backendUrls = source.match(/http:\/\/[^"'`]+:5005/g) || [];

  assert.ok(backendUrls.length > 5, "renderer backend URL inventory shrank");
  assert.equal(
    backendUrls.every((url) => url.startsWith("http://127.0.0.1:5005")),
    true,
  );
  assert.doesNotMatch(source, /http:\/\/localhost:5005/);
});
