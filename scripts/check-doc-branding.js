const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_CONTENT = Object.freeze({
  "README.md": ["# Mana Forge", "Mana Forge is the product and repository"],
  "CONTRIBUTING.md": ["# Contributing to Mana Forge"],
  NOTICE: ["Mana Forge"],
  "THIRD_PARTY.md": ["# Third-party Components and Models Used by Mana Forge"],
  "BUILD_DESKTOP.md": ["supported Mana Forge Windows installer owner"],
  "docs/quick_start_windows.md": ["# Mana Forge Quick Start for Windows"],
  "docs/runtime_configuration.md": ["Mana Forge uses one configuration contract"],
  "docs/architecture/capability-profiles.md": ["Mana Forge starts in the **Core** profile"],
  "docs/quality-gates.md": ["Mana Forge uses one required workflow"],
  "docs/release-process.md": ["Mana Forge separates a validated CI candidate"],
  "node-bot/README.md": ["# Mana Forge Local Backend"],
  "tts-service/README.md": ["# Mana Forge Local TTS Services"],
});

const REQUIRED_FIRST_LINES = Object.freeze({
  "README.md": "# Mana Forge",
  "CONTRIBUTING.md": "# Contributing to Mana Forge",
  NOTICE: "Mana Forge",
  "THIRD_PARTY.md": "# Third-party Components and Models Used by Mana Forge",
  "docs/quick_start_windows.md": "# Mana Forge Quick Start for Windows",
  "node-bot/README.md": "# Mana Forge Local Backend",
  "tts-service/README.md": "# Mana Forge Local TTS Services",
});

const EXCLUDED_PREFIXES = Object.freeze([
  "docs/adr/",
  "docs/roadmap/",
  "docs/superpowers/",
]);
const EXCLUDED_FILES = new Set(["CHANGELOG.md", "RELEASE_NOTES.md"]);

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function markdownFiles(directory, root = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(absolute, root));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(normalize(path.relative(root, absolute)));
    }
  }
  return files;
}

function currentMarkdownFiles(repoRoot) {
  const rootFiles = fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name);
  const docsFiles = markdownFiles(path.join(repoRoot, "docs")).map((file) => `docs/${file}`);
  const backendDocs = markdownFiles(path.join(repoRoot, "node-bot", "docs")).map(
    (file) => `node-bot/docs/${file}`,
  );
  return [...rootFiles, ...docsFiles, "node-bot/README.md", ...backendDocs, "tts-service/README.md"];
}

function isCurrentDocument(relativePath) {
  return (
    !EXCLUDED_FILES.has(relativePath) &&
    !EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  );
}

function validateDocBranding(repoRoot) {
  const failures = [];

  for (const [relativePath, requiredValues] of Object.entries(REQUIRED_CONTENT)) {
    const text = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    for (const value of requiredValues) {
      if (!text.includes(value)) failures.push(`${relativePath}: missing ${JSON.stringify(value)}`);
    }
  }

  for (const [relativePath, expectedFirstLine] of Object.entries(REQUIRED_FIRST_LINES)) {
    const firstLine = fs.readFileSync(path.join(repoRoot, relativePath), "utf8").split(/\r?\n/, 1)[0];
    if (firstLine !== expectedFirstLine) {
      failures.push(`${relativePath}: expected first line ${JSON.stringify(expectedFirstLine)}`);
    }
  }

  for (const relativePath of currentMarkdownFiles(repoRoot).filter(isCurrentDocument)) {
    const text = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const hasStaleWindowsPath =
      text.includes("C:\\ManaAI\\Mana") || text.includes("C:\\\\ManaAI\\\\Mana");
    const hasStaleWslPath = text.includes("/mnt/c/ManaAI/Mana");
    const hasStaleExampleUrl = /github\.com\/your-user\/Mana(?:\/|$)/i.test(text);
    if (hasStaleWindowsPath || hasStaleWslPath || hasStaleExampleUrl) {
      failures.push(`${relativePath}: contains an obsolete Mana checkout reference`);
    }
  }

  assert.deepEqual(failures, [], `Documentation branding contract failed:\n${failures.join("\n")}`);
  return { checkedEntryDocuments: Object.keys(REQUIRED_CONTENT).length };
}

function main() {
  const result = validateDocBranding(path.resolve(__dirname, ".."));
  process.stdout.write(`Documentation branding contract passed (${result.checkedEntryDocuments} entry documents).\n`);
}

if (require.main === module) main();

module.exports = { currentMarkdownFiles, isCurrentDocument, markdownFiles, validateDocBranding };
