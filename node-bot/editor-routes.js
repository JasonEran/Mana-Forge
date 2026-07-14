const {
  createEditorIntegrations,
  createZedIntegration,
} = require("./zed-integration");

function registerEditorRoutes(app, deps = {}) {
  let editorIntegrations = deps.editors || null;

  function getEditorIntegrations() {
    if (!editorIntegrations) {
      editorIntegrations = createEditorIntegrations();
    }
    return editorIntegrations;
  }

  app.get("/zed/status", (req, res) => {
    const zed = deps.zed || createZedIntegration();
    return res.json(zed.getStatus());
  });

  app.post("/zed/open", async (req, res) => {
    try {
      const zed = deps.zed || createZedIntegration();
      const result = await zed.open({
        targetPath: req.body?.path,
        line: req.body?.line,
        column: req.body?.column,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ opened: false, error: error.message });
    }
  });

  app.get("/editors/status", (req, res) => {
    return res.json(getEditorIntegrations().getStatus());
  });

  app.post("/editors/open", async (req, res) => {
    try {
      const result = await getEditorIntegrations().open({
        editor: req.body?.editor,
        targetPath: req.body?.path,
        line: req.body?.line,
        column: req.body?.column,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ opened: false, error: error.message });
    }
  });

  app.get("/editors/workspace", (req, res) => {
    return res.json({ workspace: getEditorIntegrations().getWorkspace() });
  });

  app.post("/editors/workspace", (req, res) => {
    try {
      const workspace = getEditorIntegrations().setWorkspace(req.body?.path, {
        editor: req.body?.editor,
        reason: "manual",
      });
      return res.json({ workspace });
    } catch (error) {
      return res.status(400).json({ workspace: null, error: error.message });
    }
  });

  app.get("/editors/workspace/files", (req, res) => {
    try {
      return res.json(getEditorIntegrations().listWorkspaceFiles());
    } catch (error) {
      return res.status(400).json({ files: [], error: error.message });
    }
  });

  app.get("/editors/workspace/file", (req, res) => {
    try {
      const filePath = typeof req.query.path === "string" ? req.query.path : "";
      return res.json(getEditorIntegrations().readWorkspaceFile(filePath));
    } catch (error) {
      return res.status(400).json({ content: "", error: error.message });
    }
  });

  app.get("/editors/workspace/proposals", (req, res) => {
    return res.json({ proposals: getEditorIntegrations().listEditProposals() });
  });

  app.post("/editors/workspace/proposals", (req, res) => {
    try {
      const proposal = getEditorIntegrations().createEditProposal({
        path: req.body?.path,
        proposedContent: req.body?.proposedContent,
        summary: req.body?.summary,
      });
      return res.json({ proposal });
    } catch (error) {
      return res.status(400).json({ proposal: null, error: error.message });
    }
  });

  app.get("/editors/workspace/proposals/:id", (req, res) => {
    try {
      return res.json({
        proposal: getEditorIntegrations().getEditProposal(req.params.id),
      });
    } catch (error) {
      return res.status(404).json({ proposal: null, error: error.message });
    }
  });

  app.post("/editors/workspace/proposals/:id/approve", (req, res) => {
    try {
      return res.json({
        proposal: getEditorIntegrations().approveEditProposal(req.params.id),
      });
    } catch (error) {
      return res.status(400).json({ proposal: null, error: error.message });
    }
  });
}

module.exports = { registerEditorRoutes };
