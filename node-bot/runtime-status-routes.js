function registerRuntimeStatusRoutes(app, deps) {
  const { config, getGamingStatus, getManaProcessSnapshot, perfMetrics } = deps;

  app.get("/gaming/status", (req, res) => {
    try {
      return res.json({ ok: true, ...getGamingStatus() });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message,
        gamingAppRunning: false,
        matchedProcesses: [],
        watchedProcesses: config.gamingProcessNames,
      });
    }
  });

  app.get("/perf/status", (req, res) => {
    try {
      return res.json({
        ok: true,
        uptimeSeconds: Math.round((Date.now() - perfMetrics.startedAt) / 1000),
        config: {
          whisperThreads: config.whisperThreads,
          llamaThreads: config.llamaThreads,
          llamaMaxTokens: config.llamaMaxTokens,
          screenContextEnabled: config.screenContextEnabled,
          screenContextMaxChars: config.screenContextMaxChars,
          ttsProvider: config.ttsProvider,
        },
        gaming: getGamingStatus(),
        process: getManaProcessSnapshot(),
        operations: perfMetrics.operations,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerRuntimeStatusRoutes };
