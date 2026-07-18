const {
  ValidationError,
  optionalString,
  requireString,
  sendValidationError,
} = require("./request-validation");
const { isRestartCommand } = require("./admin-restart");

async function buildOptionalPromptContext(label, builder) {
  try {
    return (await builder()) || "";
  } catch (error) {
    console.warn(`Optional ${label} context unavailable:`, error.message);
    return "";
  }
}

function registerConversationRoutes(app, deps) {
  const {
    UNIVERSALIS_DEFAULT_WORLD,
    TTS_PROVIDER,
    buildAssistantReply,
    buildCraftProfitContextForPrompt,
    buildMarketContextForPrompt,
    buildUniversalisContextForPrompt,
    buildWebContextForPrompt,
    clampText,
    getActiveModelProfile,
    getVisionStatus,
    hasRestartController,
    marketDataClient,
    normalizeLlamaModelProfile,
    recordChatTurn,
    restartController,
    runVisionReply,
    scheduleRestartAfterFinish,
    SCREEN_CONTEXT_MAX_CHARS,
    textLooksLikeCraftProfitQuestion,
    textLooksLikeMarketQuestion,
    textLooksLikeStockMarketQuestion,
    capabilityEnabled = () => false,
  } = deps;

  app.post("/reply", async (req, res) => {
    try {
      const image =
        typeof req.body?.image === "string" && req.body.image.trim()
          ? req.body.image.trim()
          : null;
      const transcript = image
        ? optionalString(req.body?.text, "text", "")
        : requireString(req.body?.text, "text");

      if (isRestartCommand(transcript)) {
        if (!hasRestartController(restartController)) {
          return res.status(500).json({ error: "restart controller is not configured" });
        }

        const payload = restartController.buildAcceptedPayload();
        scheduleRestartAfterFinish(res, restartController);
        return res.json({
          reply: payload.message,
          restart: payload,
          ttsConfigured: false,
        });
      }

      if (image) {
        if (!capabilityEnabled("vision")) {
          return res.status(409).json({ error: "vision capability is disabled" });
        }
        const sessionId = optionalString(
          req.body?.sessionId,
          "sessionId",
          null,
        );
        if (typeof getVisionStatus === "function") {
          const vision = getVisionStatus();
          if (!vision || !vision.available) {
            return res.status(503).json({
              error: "no local vision model available",
              detail: vision ? vision.reason : undefined,
            });
          }
        }
        const reply = await runVisionReply(transcript, [image]);
        if (sessionId && typeof recordChatTurn === "function") {
          recordChatTurn(sessionId, transcript || "(shared an image)", reply);
        }
        return res.json({
          reply,
          ttsConfigured: TTS_PROVIDER !== "none",
        });
      }
      const screenText = clampText(
        optionalString(req.body?.screenText, "screenText", ""),
        SCREEN_CONTEXT_MAX_CHARS,
      );
      const hasModelProfile = Object.prototype.hasOwnProperty.call(
        req.body || {},
        "modelProfile",
      );
      const modelProfile = hasModelProfile
        ? normalizeLlamaModelProfile(req.body?.modelProfile)
        : normalizeLlamaModelProfile(
            typeof getActiveModelProfile === "function"
              ? getActiveModelProfile()
              : "default",
          );
      const includeContext = req.body?.includeContext !== false;
      const world = optionalString(
        req.body?.ffxivWorld,
        "ffxivWorld",
        UNIVERSALIS_DEFAULT_WORLD,
      );
      const wantsCraftProfit =
        includeContext && typeof textLooksLikeCraftProfitQuestion === "function"
          ? textLooksLikeCraftProfitQuestion(transcript)
          : false;
      const wantsUniversalis =
        includeContext && typeof textLooksLikeMarketQuestion === "function"
          ? textLooksLikeMarketQuestion(transcript)
          : false;
      const wantsStockMarket =
        includeContext && typeof textLooksLikeStockMarketQuestion === "function"
          ? textLooksLikeStockMarketQuestion(transcript)
          : false;
      const craftProfitText = wantsCraftProfit
        ? await buildOptionalPromptContext("craft profit", () =>
            buildCraftProfitContextForPrompt(transcript, world),
          )
        : "";
      const marketText =
        craftProfitText ||
        (wantsUniversalis
          ? await buildOptionalPromptContext("Universalis", () =>
              buildUniversalisContextForPrompt(transcript, world, screenText),
            )
          : "") ||
        (wantsStockMarket
          ? await buildOptionalPromptContext("market", () =>
              buildMarketContextForPrompt(transcript, marketDataClient),
            )
          : "") ||
        (includeContext && typeof buildWebContextForPrompt === "function"
          ? await buildOptionalPromptContext("web access", () =>
              buildWebContextForPrompt(transcript),
            )
          : "");
      const sessionId = optionalString(req.body?.sessionId, "sessionId", null);
      const assistantMode = optionalString(
        req.body?.assistantMode,
        "assistantMode",
        null,
      );
      const reply = await buildAssistantReply(
        transcript,
        screenText,
        marketText,
        modelProfile,
        sessionId,
        assistantMode,
      );
      return res.json({
        reply,
        ttsConfigured: TTS_PROVIDER !== "none",
      });
    } catch (e) {
      if (e instanceof ValidationError) {
        return sendValidationError(res, e);
      }
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }
  });
}

module.exports = {
  registerConversationRoutes,
};
