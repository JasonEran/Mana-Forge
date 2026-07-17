const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const {
  createBackendServiceDescriptor,
} = require("../../runtime/services/backend");
const { runBackendSupervisor } = require("../../runtime/start-backend");

class FakeSupervisor extends EventEmitter {
  constructor() {
    super();
    this.registered = null;
    this.started = [];
    this.stopCalls = 0;
    this.startPromise = Promise.resolve();
  }

  register(descriptor) {
    this.registered = descriptor;
  }

  async start(id) {
    this.started.push(id);
    return this.startPromise;
  }

  async stopAll() {
    this.stopCalls += 1;
  }
}

function fakeProcess() {
  const processRef = new EventEmitter();
  processRef.execPath = process.execPath;
  processRef.exitCode = undefined;
  return processRef;
}

function silentLogger() {
  return { log() {}, error() {} };
}

test("backend descriptor derives one command, port, cwd, and health contract", () => {
  const repoRoot = path.resolve("C:\\Mana");
  const descriptor = createBackendServiceDescriptor({
    repoRoot,
    command: "C:\\Program Files\\nodejs\\node.exe",
    env: {
      MANA_BACKEND_URL: "http://127.0.0.1:5505/api",
      MANA_BACKEND_STARTUP_TIMEOUT_MS: "1234",
      MANA_BACKEND_SHUTDOWN_TIMEOUT_MS: "4321",
      VTUBE_STUDIO_ENABLED: "0",
    },
  });

  assert.equal(descriptor.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(descriptor.args, [path.join(repoRoot, "node-bot", "server.js")]);
  assert.equal(descriptor.cwd, path.join(repoRoot, "node-bot"));
  assert.equal(descriptor.healthUrl, "http://127.0.0.1:5505/api/health");
  assert.equal(descriptor.env.PORT, "5505");
  assert.equal(descriptor.env.MANA_BACKEND_HOST, "127.0.0.1");
  assert.equal(descriptor.env.MANA_ALLOW_REMOTE_ACCESS, "0");
  assert.equal(descriptor.env.VTUBE_STUDIO_ENABLED, "0");
  assert.equal(descriptor.startupTimeoutMs, 1234);
  assert.equal(descriptor.shutdownTimeoutMs, 4321);
  assert.equal(descriptor.restart.enabled, true);
});

test("backend descriptor rejects invalid lifecycle environment values", () => {
  assert.throws(
    () =>
      createBackendServiceDescriptor({
        env: { MANA_BACKEND_STARTUP_TIMEOUT_MS: "later" },
      }),
    /MANA_BACKEND_STARTUP_TIMEOUT_MS must be a positive integer/,
  );
});

test("backend descriptor rejects unsafe remote binding before spawn", () => {
  assert.throws(
    () =>
      createBackendServiceDescriptor({
        env: { MANA_BACKEND_HOST: "0.0.0.0" },
      }),
    /MANA_ALLOW_REMOTE_ACCESS=1/,
  );
});

test("backend descriptor does not duplicate an existing health path", () => {
  const descriptor = createBackendServiceDescriptor({
    backendUrl: "http://127.0.0.1:5005/health",
    env: {},
  });

  assert.equal(descriptor.healthUrl, "http://127.0.0.1:5005/health");
});

test("backend descriptor normalizes path URLs and rejects remote ownership", () => {
  const descriptor = createBackendServiceDescriptor({
    backendUrl: "http://localhost:5005/api/?token=not-logged#fragment",
    env: {},
  });

  assert.equal(descriptor.healthUrl, "http://localhost:5005/api/health");
  assert.throws(
    () =>
      createBackendServiceDescriptor({
        backendUrl: "https://mana.example.com",
        env: {},
      }),
    /MANA_BACKEND_URL must use a loopback host/,
  );
  assert.throws(
    () =>
      createBackendServiceDescriptor({
        backendUrl: "ftp://127.0.0.1:5005",
        env: {},
      }),
    /MANA_BACKEND_URL must use HTTP or HTTPS/,
  );
  assert.throws(
    () =>
      createBackendServiceDescriptor({
        backendUrl: "http://user:password@127.0.0.1:5005",
        env: {},
      }),
    /MANA_BACKEND_URL must not contain credentials/,
  );
  assert.equal(
    createBackendServiceDescriptor({
      backendUrl: "http://[::1]:5005",
      env: {},
    }).env.PORT,
    "5005",
  );
});

test("foreground supervisor stops cleanly on SIGINT and removes listeners", async () => {
  const supervisor = new FakeSupervisor();
  const processRef = fakeProcess();
  const descriptor = createBackendServiceDescriptor({ env: {} });
  const running = runBackendSupervisor({
    supervisor,
    processRef,
    descriptor,
    logger: silentLogger(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  processRef.emit("SIGINT");
  const exitCode = await running;

  assert.equal(exitCode, 0);
  assert.equal(processRef.exitCode, 0);
  assert.equal(supervisor.stopCalls, 1);
  assert.deepEqual(supervisor.started, ["backend"]);
  assert.equal(processRef.listenerCount("SIGINT"), 0);
  assert.equal(processRef.listenerCount("SIGTERM"), 0);
});

test("a signal during startup still waits for successful cleanup", async () => {
  const supervisor = new FakeSupervisor();
  const processRef = fakeProcess();
  let rejectStart;
  supervisor.startPromise = new Promise((_resolve, reject) => {
    rejectStart = reject;
  });
  const running = runBackendSupervisor({
    supervisor,
    processRef,
    descriptor: createBackendServiceDescriptor({ env: {} }),
    logger: silentLogger(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  processRef.emit("SIGTERM");
  rejectStart(Object.assign(new Error("cancelled"), { code: "RUNTIME_START_CANCELLED" }));
  const exitCode = await running;

  assert.equal(exitCode, 0);
  assert.equal(supervisor.stopCalls, 1);
});

test("terminal supervisor failure returns a non-zero process code", async () => {
  const supervisor = new FakeSupervisor();
  const processRef = fakeProcess();
  const running = runBackendSupervisor({
    supervisor,
    processRef,
    descriptor: createBackendServiceDescriptor({ env: {} }),
    logger: silentLogger(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  supervisor.emit("state", { id: "backend", status: "failed" });
  const exitCode = await running;

  assert.equal(exitCode, 1);
  assert.equal(processRef.exitCode, 1);
});

test("failed shutdown keeps the CLI alive so a later signal can retry", async () => {
  const supervisor = new FakeSupervisor();
  const processRef = fakeProcess();
  let releaseFirstStop;
  supervisor.stopAll = () => {
    supervisor.stopCalls += 1;
    if (supervisor.stopCalls === 1) {
      return new Promise((_resolve, reject) => {
        releaseFirstStop = () => reject(new Error("port still in use"));
      });
    }
    return Promise.resolve();
  };
  const running = runBackendSupervisor({
    supervisor,
    processRef,
    descriptor: createBackendServiceDescriptor({ env: {} }),
    logger: silentLogger(),
  });

  await new Promise((resolve) => setImmediate(resolve));
  processRef.emit("SIGINT");
  releaseFirstStop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processRef.listenerCount("SIGINT"), 1);
  assert.equal(processRef.exitCode, undefined);

  processRef.emit("SIGINT");
  const exitCode = await running;
  assert.equal(exitCode, 0);
  assert.equal(supervisor.stopCalls, 2);
});
