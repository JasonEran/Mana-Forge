function registerModelRoutes(app, { modelManagement }) {
  app.get("/models/status", (req, res) => {
    return res.json(modelManagement.getModelStatus());
  });

  app.post("/models/active-profile", (req, res) => {
    try {
      return res.json(modelManagement.setActiveProfile(req.body?.profile));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });
}

module.exports = {
  registerModelRoutes,
};
