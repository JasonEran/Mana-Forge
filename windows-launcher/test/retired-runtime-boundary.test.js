const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..", "..");
const retiredPaths = ["desktop-client", "wsl-bot", "win-bot"];
const retiredPattern = /desktop-client|wsl-bot|win-bot/i;

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

test("retired runtime sources are absent from the current tree", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  for (const retiredPath of retiredPaths) {
    assert.equal(fs.existsSync(path.join(repoRoot, retiredPath)), false);
    assert.equal(
      tracked.some((file) => file.replace(/\\/g, "/").startsWith(`${retiredPath}/`)),
      false,
      retiredPath,
    );
  }
});

test("operational CI, setup, and packaging inputs do not reference retired paths", () => {
  const files = [
    ...walkFiles(path.join(repoRoot, ".github", "workflows")),
    ...walkFiles(path.join(repoRoot, "scripts")),
    ...walkFiles(path.join(repoRoot, "windows-launcher", "scripts")),
    path.join(repoRoot, "tools", "setup-mana.ps1"),
    path.join(repoRoot, "windows-launcher", "package.json"),
  ].filter((file) => /\.(?:js|json|ps1|ya?ml)$/i.test(file));

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, retiredPattern, path.relative(repoRoot, file));
  }
});

test("current support documents contain no retired startup command", () => {
  const supportDocs = [
    "README.md",
    "CONTRIBUTING.md",
    "BUILD_DESKTOP.md",
    "RELEASE_NOTES.md",
    "docs/quick_start_windows.md",
  ];
  const retiredCommand =
    /(?:cd|Set-Location|npm\s+--prefix)[^\r\n`]*(?:desktop-client|wsl-bot|win-bot)|(?:desktop-client|wsl-bot|win-bot)[\\/](?:start\.(?:ps1|sh)|package\.json)/i;

  for (const relative of supportDocs) {
    const source = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    assert.doesNotMatch(source, retiredCommand, relative);
  }

  for (const retained of ["LICENSE", "NOTICE", "THIRD_PARTY.md", "CHANGELOG.md"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, retained)), true, retained);
  }
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "docs", "architecture", "archived-runtime-retirement.md"),
    ),
    true,
  );
});
