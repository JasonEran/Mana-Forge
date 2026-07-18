const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(DEFAULT_REPO_ROOT, "node-bot", "data");
const SECRET_NAME_PATTERN = /(API_KEY|TOKEN|SECRET|PASSCODE|PASSWORD|PRIVATE_KEY)/i;

const SAFE_DEFAULTS = {
  MANA_ALLOW_REMOTE_AI: "0",
  MANA_ALLOW_REMOTE_ACCESS: "0",
  MANA_BACKEND_HOST: "127.0.0.1",
  MANA_CORS_ALLOWED_ORIGINS: "",
  TTS_PROVIDER: "kokoro",
  KOKORO_TTS_URL: "http://127.0.0.1:5011",
  CHATTERBOX_TTS_URL: "http://127.0.0.1:5010",
  FISH_TTS_URL: "http://127.0.0.1:8080",
  MANA_BACKEND_URL: "http://127.0.0.1:5005",
};

const LLAMA_MODEL_PREFERENCE = [
  "Qwen3-4B-Q4_K_M.gguf",
  "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  "Qwen3-8B-Q4_K_M.gguf",
];

const WHISPER_MODEL_PREFERENCE = [
  "ggml-base.en.bin",
  "ggml-small.en.bin",
  "ggml-tiny.en.bin",
];

function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;

    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

function collectFiles(rootDir, predicate, fsImpl = fs) {
  if (!rootDir || !fsImpl.existsSync(rootDir)) return [];
  const matches = [];
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fsImpl.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (predicate(fullPath)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function versionScore(filePath) {
  const matches = [...String(filePath).matchAll(/(?:^|[\\/.-])b(\d+)(?:[\\/.-]|$)/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

function rankRuntimePaths(paths) {
  return [...paths].sort((left, right) => {
    const versionDelta = versionScore(right) - versionScore(left);
    if (versionDelta) return versionDelta;
    const cudaDelta = Number(/cuda/i.test(right)) - Number(/cuda/i.test(left));
    if (cudaDelta) return cudaDelta;
    return left.localeCompare(right);
  });
}

function pickPreferredFile(files, preferredNames) {
  for (const preferredName of preferredNames) {
    const match = files.find(
      (filePath) =>
        path.basename(filePath).toLowerCase() === preferredName.toLowerCase(),
    );
    if (match) return match;
  }
  return files[0] || "";
}

function discoverRuntime(repoRoot = DEFAULT_REPO_ROOT, fsImpl = fs) {
  const llamaRoot = path.join(repoRoot, "tools", "llama");
  const whisperRoot = path.join(repoRoot, "tools", "whisper");
  const llamaFiles = collectFiles(llamaRoot, () => true, fsImpl);
  const whisperFiles = collectFiles(whisperRoot, () => true, fsImpl);

  const llamaBins = rankRuntimePaths(
    llamaFiles.filter((filePath) =>
      ["llama-cli.exe", "llama-cli"].includes(path.basename(filePath).toLowerCase()),
    ),
  );
  const llamaServers = rankRuntimePaths(
    llamaFiles.filter((filePath) =>
      ["llama-server.exe", "llama-server"].includes(
        path.basename(filePath).toLowerCase(),
      ),
    ),
  );
  const llamaModels = llamaFiles.filter((filePath) => {
    const name = path.basename(filePath).toLowerCase();
    return (
      name.endsWith(".gguf") &&
      !name.includes("mmproj") &&
      !/(^|[-_.])(vl|vision|llava|minicpm-v|moondream)([-_.]|$)/i.test(name)
    );
  });
  const whisperBins = rankRuntimePaths(
    whisperFiles.filter((filePath) =>
      ["whisper-cli.exe", "whisper-cli"].includes(
        path.basename(filePath).toLowerCase(),
      ),
    ),
  );
  const whisperModels = whisperFiles.filter((filePath) =>
    /^ggml-.*\.bin$/i.test(path.basename(filePath)),
  );

  return {
    LLAMA_BIN: llamaBins[0] || "",
    LLAMA_SERVER_BIN:
      llamaServers.find(
        (candidate) =>
          llamaBins[0] && path.dirname(candidate) === path.dirname(llamaBins[0]),
      ) || llamaServers[0] || "",
    LLAMA_MODEL: pickPreferredFile(llamaModels, LLAMA_MODEL_PREFERENCE),
    WHISPER_BIN: whisperBins[0] || "",
    WHISPER_MODEL: pickPreferredFile(
      whisperModels,
      WHISPER_MODEL_PREFERENCE,
    ),
  };
}

function redactValue(name, value) {
  if (!SECRET_NAME_PATTERN.test(name)) return value;
  return value ? "[redacted]" : "";
}

function withPath(baseUrl, suffix) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(suffix || "").replace(
    /^\/+/,
    "",
  )}`;
}

function buildDiagnostics(env, sources) {
  return Object.keys(sources)
    .sort()
    .map((name) => ({
      name,
      source: sources[name],
      value: redactValue(name, env[name]),
    }));
}

function loadManaConfig(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fs || fs;
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const configFile =
    options.configFile || env.MANA_CONFIG_FILE || path.join(repoRoot, ".env");
  const sources = {};

  let fileValues = {};
  if (fsImpl.existsSync(configFile)) {
    fileValues = parseEnv(fsImpl.readFileSync(configFile, "utf8"));
    for (const [name, value] of Object.entries(fileValues)) {
      if (Object.prototype.hasOwnProperty.call(env, name)) {
        sources[name] = "environment";
      } else {
        env[name] = value;
        sources[name] = "config-file";
      }
    }
  }

  const discovered = discoverRuntime(repoRoot, fsImpl);
  for (const [name, value] of Object.entries(discovered)) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      sources[name] = sources[name] || "environment";
    } else if (value) {
      env[name] = value;
      sources[name] = "discovered";
    }
  }

  for (const [name, value] of Object.entries(SAFE_DEFAULTS)) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      sources[name] = sources[name] || "environment";
    } else {
      env[name] = value;
      sources[name] = "default";
    }
  }

  return {
    repoRoot,
    configFile,
    configFileLoaded: fsImpl.existsSync(configFile),
    env,
    sources,
    diagnostics: buildDiagnostics(env, sources),
  };
}

function resolveDataDir(env = process.env, fallback = DEFAULT_DATA_DIR) {
  const configured = String(env?.MANA_DATA_DIR || "").trim();
  return configured || fallback;
}

module.exports = {
  DEFAULT_DATA_DIR,
  DEFAULT_REPO_ROOT,
  SAFE_DEFAULTS,
  buildDiagnostics,
  discoverRuntime,
  loadManaConfig,
  parseEnv,
  rankRuntimePaths,
  redactValue,
  resolveDataDir,
  withPath,
};
