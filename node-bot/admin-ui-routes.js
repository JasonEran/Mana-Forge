const fs = require("fs");
const path = require("path");

function registerAdminUiRoutes(app) {
  const createPageHandler = (fileName) => (req, res) => {
      try {
        const filePath = path.join(__dirname, "admin", fileName);
        if (!fs.existsSync(filePath)) return res.status(404).send("not found");
        return res.sendFile(filePath);
      } catch (error) {
        return res.status(500).send(String(error));
      }
  };

  app.get("/admin/token-cache-ui", createPageHandler("token_cache_ui.html"));
  app.get(
    "/admin/background-memory-ui",
    createPageHandler("background_memory_ui.html"),
  );
}

module.exports = { registerAdminUiRoutes };
