const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const removedFiles = [
  "sprite-idle.png",
  "sprite-loading-1.png",
  "sprite-loading-2.png",
  "sprite-loading-3.png",
  "sprite-speak.png",
  "idle.png",
  "idle.svg",
  "talking.png",
  "talking.svg",
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(repoRoot, file)));
}

function trackedTextFiles() {
  return trackedFiles()
    .filter((file) => /\.(?:css|html|js|json|md|ps1|py|txt)$/i.test(file))
    .map((file) => path.join(repoRoot, file))
    .filter((file) => fs.existsSync(file));
}

test("removed avatar artwork is absent and unreferenced", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "sprites")), false);
  const tracked = trackedFiles();
  for (const removedFile of removedFiles) {
    assert.equal(
      tracked.some((file) => path.basename(file) === removedFile),
      false,
      removedFile,
    );
  }

  for (const file of trackedTextFiles()) {
    if (file === __filename) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /sprites[\\/]/i, file);
    for (const removedFile of removedFiles) {
      assert.equal(source.includes(removedFile), false, `${file}: ${removedFile}`);
    }
  }
});

test("avatar rendering is code-only and has no model runtime dependencies", () => {
  const tracked = trackedFiles();
  assert.deepEqual(
    tracked.filter((file) => file.startsWith("windows-launcher/assets/avatar/")),
    [],
  );
  assert.deepEqual(
    tracked.filter((file) => /\.(?:model3\.json|moc3|motion3\.json|exp3\.json)$/i.test(file)),
    [],
  );

  const runtimeFiles = trackedTextFiles().filter((file) => {
    const relative = path.relative(repoRoot, file).replace(/\\/g, "/");
    return (
      (relative.startsWith("windows-launcher/") &&
        !relative.startsWith("windows-launcher/test/") &&
        relative !== "windows-launcher/scripts/verify-launcher-package.js") ||
      relative.startsWith("windows-native-launcher/")
    );
  });
  for (const file of runtimeFiles) {
    if (file === __filename) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /Live2D|live2d|pixi-live2d-display|pixi\.js/i, file);
    assert.doesNotMatch(source, /assets[\\/]avatar/i, file);
  }
});

test("the tray icon is generated in memory", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "windows-launcher", "main.js"),
    "utf8",
  );
  assert.match(source, /nativeImage\.createFromBitmap\(/);
  assert.doesNotMatch(source, /nativeImage\.createFromPath\(/);
});
