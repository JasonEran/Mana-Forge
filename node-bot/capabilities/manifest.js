const CORE_CAPABILITIES = [
  {
    key: "desktopShell",
    label: "Electron desktop shell",
    owner: "Desktop Runtime",
    dependencies: ["windows-launcher", "ws"],
    processes: ["electron"],
    ports: [],
    health: "Launcher lifecycle and renderer-isolation checks",
    uninstall: "Removed with the desktop application.",
  },
  {
    key: "localApi",
    label: "Local API and text chat",
    owner: "Backend Runtime",
    dependencies: ["express", "cors", "multer"],
    processes: ["node-bot"],
    ports: ["MANA_BACKEND_URL (default 127.0.0.1:5005)"],
    health: "GET /health",
    uninstall: "Removed with the backend runtime.",
  },
  {
    key: "whisperStt",
    label: "Whisper speech-to-text",
    owner: "Speech Runtime",
    dependencies: ["whisper.cpp binary", "Whisper model"],
    processes: ["whisper-cli on demand"],
    ports: [],
    health: "Doctor validates WHISPER_BIN and WHISPER_MODEL",
    uninstall: "Remove tools/whisper after uninstalling Mana.",
  },
  {
    key: "llamaCpp",
    label: "llama.cpp local inference",
    owner: "Local AI Runtime",
    dependencies: ["llama.cpp binary", "GGUF text model"],
    processes: ["llama-server or llama-cli"],
    ports: ["LLAMA_SERVER_URL when persistent inference is enabled"],
    health: "Doctor validates the binary and model; /health reports readiness",
    uninstall: "Remove tools/llama and local models after uninstalling Mana.",
  },
  {
    key: "kokoroTts",
    label: "Kokoro text-to-speech",
    owner: "Speech Runtime",
    dependencies: ["Kokoro service runtime"],
    processes: ["kokoro-service"],
    ports: ["KOKORO_TTS_URL (default 127.0.0.1:5011)"],
    health: "Kokoro /health endpoint",
    uninstall: "Remove the Kokoro runtime after uninstalling Mana.",
  },
];

const OPTIONAL_CAPABILITIES = [
  {
    key: "vision",
    label: "Vision and OCR",
    flag: "MANA_VISION_ENABLED",
    owner: "Local AI Runtime",
    dependencies: ["tesseract.js", "optional vision GGUF and projector"],
    processes: ["Tesseract worker on demand", "llama vision inference on demand"],
    ports: [],
    health: "Doctor validates optional OCR and vision model availability",
    uninstall: "Disable the flag, run a Core install, and remove vision models/cache.",
  },
  {
    key: "retrieval",
    label: "Local retrieval",
    flag: "MANA_RETRIEVAL_ENABLED",
    owner: "Knowledge Runtime",
    dependencies: ["tools/retriever_service.py", "optional Python/vector runtime"],
    processes: ["retriever-service"],
    ports: ["RETRIEVER_HEALTH_URL (default 127.0.0.1:9000)"],
    health: "Retriever /health endpoint",
    uninstall: "Disable the flag and remove the retriever environment/vector store.",
  },
  {
    key: "webAccess",
    label: "Web access and SearXNG",
    flag: "MANA_WEB_ACCESS_ENABLED",
    owner: "Knowledge Runtime",
    dependencies: ["tools/searxng runtime", "network access"],
    processes: ["searxng when managed locally"],
    ports: ["SEARXNG_URL (default 127.0.0.1:8890)"],
    health: "SearXNG HTTP probe",
    uninstall: "Disable the flag and remove tools/searxng.",
  },
  {
    key: "stockMarket",
    label: "Stock market data",
    flag: "MANA_STOCK_MARKET_ENABLED",
    owner: "Integrations",
    dependencies: ["market provider credentials", "network access"],
    processes: [],
    ports: [],
    health: "Provider configuration reported by /health",
    uninstall: "Disable the flag and remove provider credentials.",
  },
  {
    key: "ffxivMarket",
    label: "FFXIV market data",
    flag: "MANA_FFXIV_MARKET_ENABLED",
    owner: "Integrations",
    dependencies: ["Universalis and XIVAPI network access"],
    processes: [],
    ports: [],
    health: "Provider configuration reported by /health",
    uninstall: "Disable the flag; no separate runtime remains installed.",
  },
  {
    key: "vtubeStudio",
    label: "VTube Studio",
    flag: "MANA_VTUBE_STUDIO_ENABLED",
    owner: "Desktop Integrations",
    dependencies: ["ws", "VTube Studio"],
    processes: ["VTube Studio, user managed"],
    ports: ["VTUBE_STUDIO_URL (default 127.0.0.1:8001)"],
    health: "Connection state reported by /health",
    uninstall: "Disable the flag and remove VTube Studio separately if desired.",
  },
  {
    key: "alternateTts",
    label: "Alternate TTS providers",
    flag: "MANA_ALTERNATE_TTS_ENABLED",
    owner: "Speech Runtime",
    dependencies: ["selected Chatterbox, Fish, CLI, or GPT-SoVITS runtime"],
    processes: ["selected provider service"],
    ports: ["provider-specific loopback endpoint"],
    health: "Selected provider health endpoint",
    uninstall: "Select Kokoro, disable the flag, and remove the alternate runtime.",
  },
  {
    key: "mobile",
    label: "Mobile gateway",
    flag: "MANA_MOBILE_ENABLED",
    owner: "Client Integrations",
    dependencies: ["mobile auth secrets", "optional tunnel configuration"],
    processes: ["optional tunnel, user managed"],
    ports: ["shares the authenticated local API gateway"],
    health: "Mobile auth and storage state reported by /health",
    uninstall: "Disable the flag and remove mobile pairing/memory data.",
  },
  {
    key: "editorAcp",
    label: "Editor and ACP integration",
    flag: "MANA_EDITOR_ACP_ENABLED",
    owner: "Developer Integrations",
    dependencies: ["optional axios dependency", "Zed/VS Code integration"],
    processes: ["mana-acp-agent on demand"],
    ports: ["shares the local API when the ACP bridge is used"],
    health: "Doctor checks editor and ACP entry-point availability",
    uninstall: "Disable the flag, remove the editor registration, and run a Core install.",
  },
  {
    key: "dirScanner",
    label: "Repository directory scanner",
    flag: "MANA_DIR_SCANNER_ENABLED",
    owner: "Developer Integrations",
    dependencies: [],
    processes: [],
    ports: [],
    health: "Route registration state reported by /health",
    uninstall: "Disable the flag; no separate runtime remains installed.",
  },
  {
    key: "backgroundMemory",
    label: "Background memory jobs",
    flag: "MANA_BACKGROUND_MEMORY_ENABLED",
    owner: "Knowledge Runtime",
    dependencies: ["ACP session storage"],
    processes: [],
    ports: [],
    health: "Lifecycle timer count and last job result",
    uninstall: "Disable the flag and remove background memory data if no longer needed.",
  },
  {
    key: "replyVerification",
    label: "Reply code verification",
    flag: "MANA_REPLY_VERIFICATION_ENABLED",
    owner: "Developer Integrations",
    dependencies: ["esprima"],
    processes: [],
    ports: [],
    health: "Dependency availability when explicitly enabled",
    uninstall: "Disable the flag and run a Core dependency install.",
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const DEFINITIONS = deepFreeze([
  ...CORE_CAPABILITIES.map((entry) => ({ ...entry, profile: "core" })),
  ...OPTIONAL_CAPABILITIES.map((entry) => ({ ...entry, profile: "optional" })),
]);

const DEFINITIONS_BY_KEY = new Map(DEFINITIONS.map((entry) => [entry.key, entry]));

function isCapabilityEnabled(key, env = process.env) {
  const definition = DEFINITIONS_BY_KEY.get(key);
  if (!definition) throw new Error(`unknown capability: ${key}`);
  if (definition.profile === "core") return true;

  if (String(env?.MANA_PROFILE || "core").trim().toLowerCase() === "full") {
    return true;
  }
  const value = String(env?.[definition.flag] || "").trim();
  return value === "1";
}

function resolveCapabilityManifest(env = process.env) {
  const requestedProfile = String(env?.MANA_PROFILE || "core").trim().toLowerCase();
  const profile = requestedProfile === "full" ? "full" : "core";
  const capabilities = Object.fromEntries(
    DEFINITIONS.map((definition) => {
      const enabled = isCapabilityEnabled(definition.key, env);
      return [
        definition.key,
        deepFreeze({
          ...definition,
          enabled,
          status: enabled
            ? definition.profile === "core"
              ? "available"
              : "configured"
            : "disabled",
        }),
      ];
    }),
  );

  return deepFreeze({ profile, capabilities });
}

function getCapabilityState(manifest, key) {
  return manifest?.capabilities?.[key] || null;
}

module.exports = {
  CAPABILITY_DEFINITIONS: DEFINITIONS,
  CORE_CAPABILITIES: deepFreeze([...CORE_CAPABILITIES]),
  OPTIONAL_CAPABILITIES: deepFreeze([...OPTIONAL_CAPABILITIES]),
  getCapabilityState,
  isCapabilityEnabled,
  resolveCapabilityManifest,
};
