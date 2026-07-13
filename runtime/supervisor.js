const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const net = require("net");

const DEFAULTS = Object.freeze({
  startupTimeoutMs: 15_000,
  probeIntervalMs: 250,
  shutdownTimeoutMs: 5_000,
  maxLogEntries: 500,
});

class RuntimeServiceError extends Error {
  constructor(code, serviceId, message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.serviceId = serviceId;
    this.details = details;
  }
}

class RuntimePortConflictError extends RuntimeServiceError {
  constructor(serviceId, endpoint) {
    super(
      "RUNTIME_PORT_CONFLICT",
      serviceId,
      `Service "${serviceId}" cannot start: ${endpoint.host}:${endpoint.port} is in use but did not pass its readiness probe.`,
      endpoint,
    );
  }
}

class RuntimeReadinessTimeoutError extends RuntimeServiceError {
  constructor(serviceId, timeoutMs, healthUrl) {
    super(
      "RUNTIME_READINESS_TIMEOUT",
      serviceId,
      `Service "${serviceId}" did not become ready within ${timeoutMs}ms${healthUrl ? ` at ${healthUrl}` : ""}.`,
      { timeoutMs, healthUrl },
    );
  }
}

class RuntimeProcessExitError extends RuntimeServiceError {
  constructor(serviceId, exit) {
    super(
      "RUNTIME_PROCESS_EXIT",
      serviceId,
      `Service "${serviceId}" exited before it became ready (code=${exit.code ?? "null"}, signal=${exit.signal ?? "none"}).`,
      exit,
    );
  }
}

class RuntimeShutdownError extends RuntimeServiceError {
  constructor(serviceId, pid, timeoutMs) {
    super(
      "RUNTIME_SHUTDOWN_TIMEOUT",
      serviceId,
      `Service "${serviceId}" did not release its process and port within ${timeoutMs}ms.`,
      { pid, timeoutMs },
    );
  }
}

class RuntimeSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawnProcess = options.spawnProcess || spawn;
    this.probeService = options.probeService || defaultProbeService;
    this.isPortInUse = options.isPortInUse || defaultIsPortInUse;
    this.terminateProcessTree =
      options.terminateProcessTree || defaultTerminateProcessTree;
    this.isProcessRunning = options.isProcessRunning || defaultIsProcessRunning;
    this.logger = options.logger || console;
    this.maxLogEntries = options.maxLogEntries || DEFAULTS.maxLogEntries;
    this.services = new Map();
  }

  register(descriptor) {
    const service = normalizeDescriptor(descriptor);
    if (this.services.has(service.id)) {
      throw new Error(`Runtime service "${service.id}" is already registered.`);
    }

    this.services.set(service.id, {
      descriptor: service,
      status: "stopped",
      process: null,
      owned: false,
      manualStop: false,
      startPromise: null,
      restartTimer: null,
      restartAttempts: 0,
      lastError: null,
      lastExit: null,
      pendingExit: null,
      exitPromise: null,
      resolveExit: null,
      logs: [],
      changedAt: new Date().toISOString(),
    });
    return this.getState(service.id);
  }

  async start(id) {
    const record = this.requireService(id);
    if (["starting", "restarting"].includes(record.status)) {
      return record.startPromise;
    }
    if (record.status === "ready") {
      return this.getState(id);
    }
    if (record.process && record.owned) {
      throw new RuntimeServiceError(
        "RUNTIME_PROCESS_STILL_OWNED",
        id,
        `Service "${id}" still owns process ${record.process.pid || "with unknown pid"}; stop it before starting again.`,
      );
    }
    if (record.status === "stopping") {
      throw new RuntimeServiceError(
        "RUNTIME_SERVICE_STOPPING",
        id,
        `Service "${id}" is still stopping.`,
      );
    }

    record.manualStop = false;
    record.restartAttempts = 0;
    record.lastError = null;
    record.startPromise = this.launch(record, false);
    return record.startPromise;
  }

  async startAll() {
    const entries = [...this.services.entries()];
    const results = {};
    await Promise.all(
      entries.map(async ([id, record]) => {
        try {
          results[id] = await this.start(id);
        } catch (error) {
          results[id] = this.getState(id);
          if (record.descriptor.required) throw error;
        }
      }),
    );
    return results;
  }

  async stop(id) {
    const record = this.requireService(id);
    record.manualStop = true;
    if (record.restartTimer) {
      clearTimeout(record.restartTimer);
      record.restartTimer = null;
    }

    if (!record.process || !record.owned) {
      record.process = null;
      record.owned = false;
      this.transition(record, "stopped");
      return this.getState(id);
    }

    this.transition(record, "stopping");
    const child = record.process;
    const pid = child.pid;
    let terminationError = null;
    try {
      await this.terminateProcessTree(pid, child);
    } catch (error) {
      terminationError = error;
    }
    try {
      await this.waitForRelease(record.descriptor, pid);
    } catch (error) {
      const shutdownError =
        error instanceof RuntimeShutdownError
          ? error
          : new RuntimeShutdownError(
              id,
              pid,
              record.descriptor.shutdownTimeoutMs,
            );
      record.lastError = serializeError(shutdownError);
      this.transition(record, "failed");
      throw shutdownError;
    }
    if (terminationError) {
      this.appendLog(
        record,
        "stderr",
        `Process-tree termination reported an error after release: ${terminationError.message}`,
      );
    }

    if (record.process === child) {
      record.process = null;
    }
    record.owned = false;
    this.transition(record, "stopped");
    return this.getState(id);
  }

  async stopAll() {
    const errors = [];
    const ids = [...this.services.keys()].reverse();
    for (const id of ids) {
      try {
        await this.stop(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "One or more runtime services failed to stop.");
    }
  }

  getState(id) {
    const record = this.requireService(id);
    return Object.freeze({
      id,
      required: record.descriptor.required,
      status: record.status,
      owned: record.owned,
      pid: record.process?.pid || null,
      restartAttempts: record.restartAttempts,
      lastError: record.lastError,
      lastExit: record.lastExit,
      changedAt: record.changedAt,
    });
  }

  getStates() {
    return Object.fromEntries(
      [...this.services.keys()].map((id) => [id, this.getState(id)]),
    );
  }

  getLogs(id) {
    return this.requireService(id).logs.map((entry) => ({ ...entry }));
  }

  requireService(id) {
    const record = this.services.get(id);
    if (!record) {
      throw new Error(`Unknown runtime service "${id}".`);
    }
    return record;
  }

  async launch(record, restarting) {
    const descriptor = record.descriptor;
    this.transition(record, restarting ? "restarting" : "starting");

    const alreadyReady = await this.safeProbe(
      descriptor,
      Math.min(1_000, descriptor.probeIntervalMs),
    );
    this.assertStartActive(record);
    if (alreadyReady) {
      if (!descriptor.allowExisting) {
        const error = new RuntimePortConflictError(
          descriptor.id,
          endpointFromDescriptor(descriptor) || { host: "unknown", port: 0 },
        );
        record.lastError = serializeError(error);
        this.transition(record, "failed");
        throw error;
      }
      record.owned = false;
      record.process = null;
      this.appendLog(record, "system", "Using an already-running healthy service.");
      this.transition(record, "ready");
      return this.getState(descriptor.id);
    }

    const endpoint = endpointFromDescriptor(descriptor);
    const portInUse = endpoint ? await this.isPortInUse(endpoint) : false;
    this.assertStartActive(record);
    if (portInUse) {
      const error = new RuntimePortConflictError(descriptor.id, endpoint);
      record.lastError = serializeError(error);
      this.transition(record, "failed");
      throw error;
    }
    record.pendingExit = null;
    record.exitPromise = new Promise((resolve) => {
      record.resolveExit = resolve;
    });

    let child;
    try {
      child = this.spawnProcess(descriptor.command, descriptor.args, {
        cwd: descriptor.cwd,
        env: { ...process.env, ...descriptor.env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const spawnError = new RuntimeServiceError(
        "RUNTIME_SPAWN_FAILED",
        descriptor.id,
        `Service "${descriptor.id}" could not be spawned: ${error.message}`,
      );
      record.lastError = serializeError(spawnError);
      this.transition(record, "failed");
      throw spawnError;
    }

    record.process = child;
    record.owned = true;
    this.observeChild(record, child);
    this.appendLog(record, "system", `Started process ${child.pid || "without pid"}.`);

    try {
      await this.waitUntilReady(record);
      if (record.manualStop) {
        throw new RuntimeServiceError(
          "RUNTIME_START_CANCELLED",
          descriptor.id,
          `Service "${descriptor.id}" was stopped during startup.`,
        );
      }
      this.transition(record, "ready");
      return this.getState(descriptor.id);
    } catch (error) {
      if (record.manualStop) {
        record.lastError = null;
        this.transition(record, "stopped");
      } else {
        record.lastError = serializeError(error);
        this.transition(record, "failed");
      }
      if (record.process === child) {
        const cleanupError = await this.cleanupFailedStart(record, child);
        if (cleanupError) {
          record.lastError = serializeError(cleanupError);
          throw cleanupError;
        }
      }
      throw error;
    }
  }

  assertStartActive(record) {
    if (!record.manualStop) return;
    throw new RuntimeServiceError(
      "RUNTIME_START_CANCELLED",
      record.descriptor.id,
      `Service "${record.descriptor.id}" was stopped during startup.`,
    );
  }

  observeChild(record, child) {
    let exitObserved = false;
    const finish = (code, signal, error) => {
      if (exitObserved) return;
      exitObserved = true;
      const exit = {
        code: code ?? null,
        signal: signal || null,
        expected: record.manualStop || record.status === "stopping",
        at: new Date().toISOString(),
      };
      if (error) exit.error = error.message;
      this.handleChildExit(record, child, exit);
    };

    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal));
    this.captureOutput(record, child.stdout, "stdout");
    this.captureOutput(record, child.stderr, "stderr");
  }

  captureOutput(record, stream, source) {
    if (!stream?.on) return;
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line) this.appendLog(record, source, line);
      }
    });
  }

  handleChildExit(record, child, exit) {
    if (record.process !== child) return;
    record.process = null;
    record.owned = false;
    record.lastExit = exit;
    record.pendingExit = exit;
    record.resolveExit?.(exit);
    record.resolveExit = null;
    this.appendLog(
      record,
      "system",
      `Process exited (code=${exit.code ?? "null"}, signal=${exit.signal || "none"}).`,
    );

    if (record.manualStop || record.status === "stopping") {
      this.transition(record, "stopped");
      return;
    }

    if (record.status === "ready") {
      this.transition(record, "crashed");
      this.scheduleRestart(record);
    }
  }

  scheduleRestart(record) {
    const policy = record.descriptor.restart;
    if (record.process && record.owned) {
      const error = new RuntimeServiceError(
        "RUNTIME_PROCESS_STILL_OWNED",
        record.descriptor.id,
        `Service "${record.descriptor.id}" cannot restart while process ${record.process.pid || "with unknown pid"} is still owned.`,
      );
      record.lastError = serializeError(error);
      this.transition(record, "failed");
      return;
    }
    if (!policy.enabled || record.manualStop) {
      this.transition(record, "failed");
      return;
    }
    if (record.restartAttempts >= policy.maxAttempts) {
      const error = new RuntimeServiceError(
        "RUNTIME_RESTART_EXHAUSTED",
        record.descriptor.id,
        `Service "${record.descriptor.id}" exhausted ${policy.maxAttempts} restart attempts.`,
      );
      record.lastError = serializeError(error);
      this.transition(record, "failed");
      return;
    }

    record.restartAttempts += 1;
    const delayMs = Math.min(
      policy.baseDelayMs * 2 ** (record.restartAttempts - 1),
      policy.maxDelayMs,
    );
    this.transition(record, "restarting");
    this.appendLog(
      record,
      "system",
      `Restart attempt ${record.restartAttempts}/${policy.maxAttempts} in ${delayMs}ms.`,
    );
    record.restartTimer = setTimeout(() => {
      record.restartTimer = null;
      if (record.manualStop) return;
      record.startPromise = this.launch(record, true).catch((error) => {
        if (record.manualStop) {
          record.lastError = null;
          this.transition(record, "stopped");
          return this.getState(record.descriptor.id);
        }
        record.lastError = serializeError(error);
        this.scheduleRestart(record);
        return this.getState(record.descriptor.id);
      });
    }, delayMs);
  }

  async waitUntilReady(record) {
    const descriptor = record.descriptor;
    const deadline = Date.now() + descriptor.startupTimeoutMs;
    while (Date.now() <= deadline) {
      this.assertStartActive(record);
      if (record.pendingExit) {
        throw new RuntimeProcessExitError(descriptor.id, record.pendingExit);
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      if (await this.safeProbe(descriptor, remainingMs)) return;
      this.assertStartActive(record);
      const waitRemainingMs = deadline - Date.now();
      if (waitRemainingMs <= 0) break;
      await Promise.race([
        delay(Math.min(descriptor.probeIntervalMs, waitRemainingMs)),
        record.exitPromise,
      ]);
    }
    if (record.pendingExit) {
      throw new RuntimeProcessExitError(descriptor.id, record.pendingExit);
    }
    throw new RuntimeReadinessTimeoutError(
      descriptor.id,
      descriptor.startupTimeoutMs,
      redactUrl(descriptor.healthUrl),
    );
  }

  async safeProbe(descriptor, timeoutMs) {
    try {
      return Boolean(await withTimeout(this.probeService(descriptor), timeoutMs));
    } catch (_error) {
      return false;
    }
  }

  async cleanupFailedStart(record, child) {
    let terminationError = null;
    try {
      await this.terminateProcessTree(child.pid, child);
    } catch (error) {
      terminationError = error;
    }
    try {
      await this.waitForRelease(record.descriptor, child.pid);
    } catch (error) {
      const cleanupError =
        error instanceof RuntimeShutdownError
          ? error
          : new RuntimeShutdownError(
              record.descriptor.id,
              child.pid,
              record.descriptor.shutdownTimeoutMs,
            );
      this.appendLog(
        record,
        "stderr",
        `Failed startup cleanup: ${cleanupError.message}`,
      );
      record.owned = record.process === child;
      return cleanupError;
    }
    if (terminationError) {
      this.appendLog(
        record,
        "stderr",
        `Process-tree termination reported an error after release: ${terminationError.message}`,
      );
    }
    if (record.process === child) record.process = null;
    record.owned = false;
    return null;
  }

  async waitForRelease(descriptor, pid) {
    const endpoint = endpointFromDescriptor(descriptor);
    const deadline = Date.now() + descriptor.shutdownTimeoutMs;
    while (Date.now() <= deadline) {
      const processRunning = pid ? await this.isProcessRunning(pid) : false;
      const portInUse = endpoint ? await this.isPortInUse(endpoint) : false;
      if (!processRunning && !portInUse) return;
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    throw new RuntimeShutdownError(
      descriptor.id,
      pid,
      descriptor.shutdownTimeoutMs,
    );
  }

  transition(record, status) {
    record.status = status;
    record.changedAt = new Date().toISOString();
    this.emit("state", this.getState(record.descriptor.id));
  }

  appendLog(record, source, message) {
    const entry = {
      at: new Date().toISOString(),
      serviceId: record.descriptor.id,
      source,
      message,
    };
    record.logs.push(entry);
    if (record.logs.length > this.maxLogEntries) record.logs.shift();
    this.emit("log", { ...entry });
    const method = source === "stderr" ? "warn" : "log";
    this.logger?.[method]?.(`[${record.descriptor.id}] ${message}`);
  }
}

function normalizeDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("A runtime service descriptor is required.");
  }
  if (!descriptor.id || !/^[a-z0-9][a-z0-9-]*$/.test(descriptor.id)) {
    throw new TypeError("Runtime service id must use lowercase letters, digits, and hyphens.");
  }
  if (!descriptor.command || typeof descriptor.command !== "string") {
    throw new TypeError(`Runtime service "${descriptor.id}" requires a command.`);
  }
  if (!descriptor.healthUrl && typeof descriptor.readinessProbe !== "function") {
    throw new TypeError(
      `Runtime service "${descriptor.id}" requires healthUrl or readinessProbe.`,
    );
  }

  if (descriptor.healthUrl) {
    let url;
    try {
      url = new URL(descriptor.healthUrl);
    } catch (_error) {
      throw new TypeError(
        `Runtime service "${descriptor.id}" healthUrl must be a valid URL.`,
      );
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new TypeError(
        `Runtime service "${descriptor.id}" healthUrl must use HTTP or HTTPS.`,
      );
    }
  }

  const startupTimeoutMs = positiveInteger(
    descriptor.startupTimeoutMs,
    DEFAULTS.startupTimeoutMs,
    `${descriptor.id}.startupTimeoutMs`,
  );
  const probeIntervalMs = positiveInteger(
    descriptor.probeIntervalMs,
    DEFAULTS.probeIntervalMs,
    `${descriptor.id}.probeIntervalMs`,
  );
  const shutdownTimeoutMs = positiveInteger(
    descriptor.shutdownTimeoutMs,
    DEFAULTS.shutdownTimeoutMs,
    `${descriptor.id}.shutdownTimeoutMs`,
  );
  const maxAttempts = nonNegativeInteger(
    descriptor.restart?.maxAttempts,
    3,
    `${descriptor.id}.restart.maxAttempts`,
  );
  const baseDelayMs = positiveInteger(
    descriptor.restart?.baseDelayMs,
    500,
    `${descriptor.id}.restart.baseDelayMs`,
  );
  const maxDelayMs = positiveInteger(
    descriptor.restart?.maxDelayMs,
    5_000,
    `${descriptor.id}.restart.maxDelayMs`,
  );

  return Object.freeze({
    id: descriptor.id,
    required: descriptor.required !== false,
    command: descriptor.command,
    args: Object.freeze([...(descriptor.args || [])]),
    cwd: descriptor.cwd,
    env: Object.freeze({ ...(descriptor.env || {}) }),
    healthUrl: descriptor.healthUrl || null,
    readinessProbe: descriptor.readinessProbe || null,
    allowExisting: descriptor.allowExisting === true,
    startupTimeoutMs,
    probeIntervalMs,
    shutdownTimeoutMs,
    restart: Object.freeze({
      enabled: descriptor.restart?.enabled === true,
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
    }),
  });
}

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function endpointFromDescriptor(descriptor) {
  if (!descriptor.healthUrl) return null;
  const url = new URL(descriptor.healthUrl);
  return {
    host: url.hostname === "[::1]" ? "::1" : url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

function redactUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "configured readiness endpoint";
  }
}

async function defaultProbeService(descriptor) {
  if (descriptor.readinessProbe) return descriptor.readinessProbe();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(descriptor.healthUrl, {
      signal: controller.signal,
    });
    return response.ok;
  } finally {
    clearTimeout(timer);
  }
}

function defaultIsPortInUse({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function defaultTerminateProcessTree(pid, child) {
  if (!pid) {
    child?.kill?.();
    return;
  }
  if (process.platform === "win32") {
    await runProcess("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function defaultIsProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

function serializeError(error) {
  return Object.freeze({
    name: error.name,
    code: error.code || "RUNTIME_ERROR",
    message: error.message,
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

module.exports = {
  RuntimePortConflictError,
  RuntimeProcessExitError,
  RuntimeReadinessTimeoutError,
  RuntimeServiceError,
  RuntimeShutdownError,
  RuntimeSupervisor,
};
