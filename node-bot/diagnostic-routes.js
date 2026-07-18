const { buildCapabilityHealth } = require("./capabilities/registry");

function makeHealthComponent(status, configured, message, details = {}) {
  return {
    status,
    configured: Boolean(configured),
    message,
    ...details,
  };
}

function hasEnvValue(env, names) {
  return names.some(
    (name) => typeof env[name] === "string" && env[name].trim(),
  );
}

function buildHealthComponents({
  capabilityManifest,
  env,
  llamaStatus,
  mobileMemoryStore,
  ttsBin,
  ttsProvider,
  whisperBin,
  whisperModel,
}) {
  const capabilityEnabled = (key) =>
    Boolean(capabilityManifest?.capabilities?.[key]?.enabled);
  const disabled = (key) =>
    makeHealthComponent(
      "disabled",
      false,
      `${capabilityManifest?.capabilities?.[key]?.label || key} is disabled.`,
      { enabled: false },
    );
  const mobileAuthConfigured =
    hasEnvValue(env, ["MOBILE_PASSCODE_HASH", "MANA_MOBILE_PASSCODE_HASH"]) &&
    hasEnvValue(env, ["MOBILE_SESSION_SECRET", "MANA_MOBILE_SESSION_SECRET"]);
  const cloudflareConfigured = hasEnvValue(env, [
    "CLOUDFLARE_TUNNEL_TOKEN",
    "CLOUDFLARE_TUNNEL_ID",
    "CLOUDFLARE_TUNNEL_URL",
    "MANA_TUNNEL_URL",
  ]);
  const mobileEnabled = capabilityEnabled("mobile");
  const vtubeEnabled = capabilityEnabled("vtubeStudio");
  const whisperConfigured = Boolean(whisperBin && whisperModel);
  const ttsConfigured = ttsProvider !== "none";
  const ttsStatus = !ttsConfigured
    ? "unavailable"
    : ttsProvider === "cli" && !ttsBin
      ? "degraded"
      : "configured";

  return {
    backend: makeHealthComponent("available", true, "Backend is running."),
    localLlama: makeHealthComponent(
      llamaStatus.ok ? "available" : "unavailable",
      llamaStatus.ok,
      llamaStatus.message,
      { model: llamaStatus.model, bin: llamaStatus.bin },
    ),
    whisper: makeHealthComponent(
      whisperConfigured ? "available" : "unavailable",
      whisperConfigured,
      whisperConfigured
        ? "Whisper is configured."
        : "Whisper binary or model is missing.",
      {
        binConfigured: Boolean(whisperBin),
        modelConfigured: Boolean(whisperModel),
      },
    ),
    tts: makeHealthComponent(
      ttsStatus,
      ttsConfigured,
      ttsConfigured ? `TTS provider is ${ttsProvider}.` : "TTS is disabled.",
      { provider: ttsProvider },
    ),
    mobileAuth: mobileEnabled
      ? makeHealthComponent(
          mobileAuthConfigured ? "configured" : "degraded",
          mobileAuthConfigured,
          mobileAuthConfigured
            ? "Mobile auth is configured."
            : "Mobile auth is enabled but secrets are missing.",
          { enabled: true },
        )
      : disabled("mobile"),
    localMemory: mobileEnabled
      ? makeHealthComponent(
          mobileMemoryStore?.filePath ? "available" : "degraded",
          Boolean(mobileMemoryStore?.filePath),
          mobileMemoryStore?.filePath
            ? "Local mobile memory store is available."
            : "Local mobile memory store path is unavailable.",
          { enabled: true, filePath: mobileMemoryStore?.filePath || null },
        )
      : disabled("mobile"),
    cloudflareTunnel: mobileEnabled
      ? makeHealthComponent(
          cloudflareConfigured ? "configured" : "degraded",
          cloudflareConfigured,
          cloudflareConfigured
            ? "Cloudflare Tunnel is configured."
            : "Mobile is enabled without a configured Cloudflare Tunnel.",
          { enabled: true },
        )
      : disabled("mobile"),
    vtubeStudio: vtubeEnabled
      ? makeHealthComponent(
          "configured",
          true,
          "VTube Studio integration is configured.",
          { enabled: true },
        )
      : disabled("vtubeStudio"),
  };
}

function addManifestHealth(components, capabilityManifest) {
  for (const capability of Object.values(
    capabilityManifest?.capabilities || {},
  )) {
    if (capability.profile !== "optional" || components[capability.key]) continue;
    components[capability.key] = makeHealthComponent(
      capability.enabled ? "configured" : "disabled",
      capability.enabled,
      capability.enabled
        ? `${capability.label} is configured for this profile.`
        : `${capability.label} is disabled.`,
      { enabled: capability.enabled },
    );
  }
  return components;
}

function registerDiagnosticRoutes(app, deps) {
  app.get("/doctor", async (req, res) => {
    try {
      const result = await deps.runDoctor();
      return res.status(result.ok ? 200 : 503).json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/health", (req, res) => {
    const llamaStatus = deps.getLlamaStatus();
    const components = buildHealthComponents({
      capabilityManifest: deps.capabilityManifest,
      env: deps.env,
      llamaStatus,
      mobileMemoryStore: deps.mobileMemoryStore,
      ttsBin: deps.ttsBin,
      ttsProvider: deps.ttsProvider,
      whisperBin: deps.whisperBin,
      whisperModel: deps.whisperModel,
    });
    Object.assign(
      components,
      buildCapabilityHealth(deps.capabilities, deps.capabilityContext),
    );
    addManifestHealth(components, deps.capabilityManifest);

    return res.json({
      ok: true,
      ttsConfigured: deps.ttsProvider !== "none",
      ttsProvider: deps.ttsProvider,
      kokoroTtsUrl: deps.kokoroTtsUrl,
      chatterboxTtsUrl: deps.chatterboxTtsUrl,
      fishTtsUrl: deps.fishTtsUrl,
      llamaConfigured: llamaStatus.ok,
      llamaModel: llamaStatus.model,
      llamaBin: llamaStatus.bin,
      llamaStatus: llamaStatus.message,
      remoteAiEnabled: deps.shouldUseRemoteAi(),
      vtubeStudioConfigured: Boolean(deps.vtubeStudio),
      vtubeStudioUrl: deps.vtubeStudioUrl,
      marketProvider: deps.marketProvider,
      marketConfigured: Boolean(deps.marketDataClient?.isConfigured),
      components,
    });
  });
}

module.exports = {
  addManifestHealth,
  buildHealthComponents,
  registerDiagnosticRoutes,
};
