const { classifyIntent } = require("./utils/intent-classifier");

function registerDebugRoutes(app) {
  app.post("/debug/intent", (req, res) => {
    const { text } = req.body || {};
    if (text === undefined || typeof text !== "string") {
      return res.status(400).json({
        success: false,
        error: "Bad Request",
        message: "Missing or invalid 'text' property in the JSON body payload.",
      });
    }
    try {
      return res.status(200).json({
        success: true,
        input_length: text.length,
        ...classifyIntent(text),
      });
    } catch (error) {
      console.error("[/debug/intent] Router checkpoint failed:", error?.message || error);
      return res.status(500).json({
        success: false,
        error: "Internal Server Error",
        message: error?.message || String(error),
      });
    }
  });
}

module.exports = { registerDebugRoutes };
