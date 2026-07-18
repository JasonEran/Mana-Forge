const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  discoverRuntime,
  loadManaConfig,
  parseEnv,
  resolveDataDir,
  withPath,
} = require("../../runtime/config");

function writeFile(root, relativePath, contents = "test") {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test("parseEnv supports comments, export, quotes, and equals in values", () => {
  assert.deepEqual(
    parseEnv(`
      # ignored
      export MANA_ALLOW_REMOTE_AI=0
      LLAMA_MODEL="C:\\models\\mana.gguf"
      URL='http://127.0.0.1:5005/path?a=b'
      INVALID LINE
    `),
    {
      MANA_ALLOW_REMOTE_AI: "0",
      LLAMA_MODEL: "C:\\models\\mana.gguf",
      URL: "http://127.0.0.1:5005/path?a=b",
    },
  );
});

test("withPath joins service URLs without duplicate slashes", () => {
  assert.equal(withPath("http://127.0.0.1:5005/", "/health"), "http://127.0.0.1:5005/health");
});

test("resolveDataDir preserves the development fallback and accepts packaged storage", () => {
  const fallback = path.resolve("node-bot", "data");
  const packaged = path.resolve("mana-user-data", "data");

  assert.equal(resolveDataDir({}, fallback), fallback);
  assert.equal(resolveDataDir({ MANA_DATA_DIR: packaged }, fallback), packaged);
});

test("loadManaConfig gives process environment precedence over root .env", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(
    root,
    ".env",
    "TTS_PROVIDER=chatterbox\nOPENAI_API_KEY=from-file\nPORT=5006\n",
  );

  const env = {
    TTS_PROVIDER: "none",
    OPENAI_API_KEY: "from-shell",
    UNRELATED_HOST_VALUE: "do-not-report",
  };
  const result = loadManaConfig({ repoRoot: root, env });

  assert.equal(env.TTS_PROVIDER, "none");
  assert.equal(env.OPENAI_API_KEY, "from-shell");
  assert.equal(env.PORT, "5006");
  assert.equal(env.MANA_ALLOW_REMOTE_AI, "0");
  assert.equal(result.sources.TTS_PROVIDER, "environment");
  assert.equal(result.sources.PORT, "config-file");
  assert.equal(result.sources.MANA_ALLOW_REMOTE_AI, "default");
  assert.equal(
    result.diagnostics.find((item) => item.name === "OPENAI_API_KEY").value,
    "[redacted]",
  );
  assert.equal(
    result.diagnostics.some((item) => item.name === "UNRELATED_HOST_VALUE"),
    false,
  );
});

test("discoverRuntime selects the newest versioned CUDA llama runtime", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "tools/llama/llama-b9000-bin-win-cpu-x64/llama-cli.exe");
  writeFile(root, "tools/llama/llama-b9984-bin-win-cuda-13.3-x64/llama-cli.exe");
  const server = writeFile(
    root,
    "tools/llama/llama-b9984-bin-win-cuda-13.3-x64/llama-server.exe",
  );
  const model = writeFile(
    root,
    "tools/llama/gguf-models/Qwen3-4B-Q4_K_M.gguf",
  );

  const discovered = discoverRuntime(root);
  assert.match(discovered.LLAMA_BIN, /b9984.*cuda.*llama-cli\.exe$/i);
  assert.equal(discovered.LLAMA_SERVER_BIN, server);
  assert.equal(discovered.LLAMA_MODEL, model);
});

test("discoverRuntime prefers CUDA when runtime versions match", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-runtime-cuda-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFile(root, "tools/llama/llama-b9984-bin-win-cpu-x64/llama-cli.exe");
  writeFile(root, "tools/llama/llama-b9984-bin-win-cuda-13.3-x64/llama-cli.exe");

  assert.match(discoverRuntime(root).LLAMA_BIN, /cuda.*llama-cli\.exe$/i);
});

test("discoverRuntime finds Whisper binary and preferred local model", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mana-whisper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = writeFile(root, "tools/whisper/Release/whisper-cli.exe");
  writeFile(root, "tools/whisper/models/ggml-tiny.en.bin");
  const model = writeFile(root, "tools/whisper/models/ggml-base.en.bin");

  const discovered = discoverRuntime(root);
  assert.equal(discovered.WHISPER_BIN, bin);
  assert.equal(discovered.WHISPER_MODEL, model);
});
