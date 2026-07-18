const {
  ValidationError,
  optionalString,
  requireString,
  sendValidationError,
} = require("./request-validation");
const {
  getRequestAddress,
  isLoopbackAddress,
} = require("./admin-restart");
const { registerConversationRoutes } = require("./conversation-routes");
const { registerSpeechRoutes } = require("./speech-routes");

const RESTART_LOCAL_ONLY_ERROR = "restart is only available from this PC";

function getSocketAddress(req) {
  return req?.socket?.remoteAddress || "";
}

function getFirstForwardedAddress(req) {
  const forwardedFor =
    typeof req.get === "function"
      ? req.get("x-forwarded-for")
      : req?.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(value || "")
    .split(",")[0]
    .trim();
}

// Loopback-only, and if a proxy claims the socket is loopback (e.g. a
// LAN tunnel terminating on the same box), an X-Forwarded-For header
// pointing elsewhere still disqualifies the request.
function isLocalRestartRequest(req) {
  const socketAddress = getSocketAddress(req);
  const requestAddress = getRequestAddress(req);
  const forwardedAddress = getFirstForwardedAddress(req);
  return (
    isLoopbackAddress(socketAddress || requestAddress) &&
    (!forwardedAddress || isLoopbackAddress(forwardedAddress))
  );
}

function hasRestartController(restartController) {
  return (
    restartController &&
    typeof restartController.buildAcceptedPayload === "function" &&
    typeof restartController.scheduleRestart === "function"
  );
}

function scheduleRestartAfterFinish(res, restartController) {
  res.once("finish", () => restartController.scheduleRestart());
}

function registerCoreRoutes(app, upload, deps) {
  const {
    TTS_PROVIDER,
    marketDataClient,
    readScreenText,
    recordChatTurn,
    restartController,
    runVisionReply,
    getVisionStatus,
    capabilityEnabled = () => false,
  } = deps;

  app.post("/admin/restart", (req, res) => {
    if (!hasRestartController(restartController)) {
      return res.status(500).json({ error: "restart controller is not configured" });
    }
    if (!isLocalRestartRequest(req)) {
      return res.status(403).json({ error: RESTART_LOCAL_ONLY_ERROR });
    }

    const payload = restartController.buildAcceptedPayload();
    scheduleRestartAfterFinish(res, restartController);
    return res.json(payload);
  });

  if (capabilityEnabled("vision")) {
    app.post("/screen/read", async (req, res) => {
      try {
        const image = typeof req.body?.image === "string" ? req.body.image : "";
        if (!image) {
          return res.status(400).json({ error: "no screen image" });
        }

        const text = await readScreenText(image);
        return res.json({ text });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: String(e) });
      }
    });
  }

  if (capabilityEnabled("stockMarket")) {
    app.get("/market/stock/summary", async (req, res) => {
    try {
      const symbol =
        typeof req.query.symbol === "string" ? req.query.symbol : "";
      const summary = await marketDataClient.getStockSummary(symbol);
      return res.json({
        ...summary,
        disclaimer: "Market analysis only. Not financial advice.",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }
    });

    app.get("/market/stock/compare", async (req, res) => {
    try {
      const symbols =
        typeof req.query.symbols === "string" ? req.query.symbols : "";
      const results = await marketDataClient.compareStocks(symbols);
      return res.json({
        source: "Alpha Vantage",
        symbols: results.map((item) => item.symbol),
        results,
        disclaimer: "Market analysis only. Not financial advice.",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }
    });

    app.get("/market/watchlist", async (req, res) => {
    try {
      const results = await marketDataClient.getWatchlistSummary();
      return res.json({
        source: "Alpha Vantage",
        symbols: results.map((item) => item.symbol),
        results,
        disclaimer: "Market analysis only. Not financial advice.",
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: String(e) });
    }
    });
  }

  if (capabilityEnabled("vision")) {
    app.post("/vision/describe", async (req, res) => {
    try {
      const image = requireString(req.body?.image, "image");
      const prompt = optionalString(req.body?.prompt, "prompt", "");
      const sessionId = optionalString(req.body?.sessionId, "sessionId", null);

      if (typeof getVisionStatus === "function") {
        const vision = getVisionStatus();
        if (!vision || !vision.available) {
          return res.status(503).json({
            error: "no local vision model available",
            detail: vision ? vision.reason : undefined,
          });
        }
      }

      const reply = await runVisionReply(prompt, [image]);
      if (sessionId && typeof recordChatTurn === "function") {
        recordChatTurn(sessionId, prompt || "(shared an image)", reply);
      }
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

  registerConversationRoutes(app, {
    ...deps,
    hasRestartController,
    scheduleRestartAfterFinish,
  });
  registerSpeechRoutes(app, upload, deps);
}

module.exports = {
  registerCoreRoutes,
};
