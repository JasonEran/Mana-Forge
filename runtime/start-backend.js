const { loadManaConfig } = require("./config");
const { createBackendServiceDescriptor } = require("./services/backend");
const { RuntimeSupervisor } = require("./supervisor");

async function runBackendSupervisor(options = {}) {
  const processRef = options.processRef || process;
  const logger = options.logger || console;
  const supervisor =
    options.supervisor || new RuntimeSupervisor({ logger });
  const descriptor =
    options.descriptor ||
    createBackendServiceDescriptor({ command: processRef.execPath || "node" });

  supervisor.register(descriptor);

  let stopping = false;
  let startupComplete = false;
  let settled = false;
  let resolveTerminal;
  const terminal = new Promise((resolve) => {
    resolveTerminal = resolve;
  });
  const finish = (exitCode) => {
    if (settled) return;
    settled = true;
    resolveTerminal(exitCode);
  };

  const onState = (state) => {
    if (state.id !== descriptor.id || stopping || !startupComplete) return;
    if (state.status === "failed") {
      logger.error?.(
        `[${descriptor.id}] Supervisor stopped after a terminal runtime failure.`,
      );
      finish(1);
    }
  };

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.log?.(`[${descriptor.id}] Received ${signal}; stopping runtime.`);
    try {
      await supervisor.stopAll();
      finish(0);
    } catch (error) {
      stopping = false;
      logger.error?.(`[${descriptor.id}] Shutdown failed: ${error.message}`);
    }
  };

  const onSigint = () => void shutdown("SIGINT");
  const onSigterm = () => void shutdown("SIGTERM");
  supervisor.on("state", onState);
  processRef.on("SIGINT", onSigint);
  processRef.on("SIGTERM", onSigterm);

  try {
    try {
      await supervisor.start(descriptor.id);
    } catch (error) {
      if (!stopping) throw error;
      const exitCode = await terminal;
      processRef.exitCode = exitCode;
      return exitCode;
    }
    startupComplete = true;
    logger.log?.(
      `[${descriptor.id}] Ready at ${descriptor.healthUrl}; press Ctrl+C to stop.`,
    );
    const exitCode = await terminal;
    processRef.exitCode = exitCode;
    return exitCode;
  } finally {
    supervisor.off("state", onState);
    processRef.off("SIGINT", onSigint);
    processRef.off("SIGTERM", onSigterm);
  }
}

async function main() {
  loadManaConfig();
  try {
    await runBackendSupervisor();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  runBackendSupervisor,
};
