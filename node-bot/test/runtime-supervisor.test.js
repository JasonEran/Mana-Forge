const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  RuntimePortConflictError,
  RuntimeReadinessTimeoutError,
  RuntimeSupervisor,
} = require("../../runtime/supervisor");

function createChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit("close", 0, null);
  return child;
}

function descriptor(overrides = {}) {
  return {
    id: "backend",
    required: true,
    command: "node",
    args: ["server.js"],
    cwd: "C:\\Mana\\node-bot",
    healthUrl: "http://127.0.0.1:5005/health",
    startupTimeoutMs: 40,
    probeIntervalMs: 2,
    shutdownTimeoutMs: 40,
    restart: { enabled: true, maxAttempts: 2, baseDelayMs: 2, maxDelayMs: 4 },
    ...overrides,
  };
}

function silentLogger() {
  return { log() {}, warn() {} };
}

async function waitFor(predicate, timeoutMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Timed out waiting for supervisor state.");
}

test("starts once, reaches ready, and records child output", async () => {
  let spawnCount = 0;
  let ready = false;
  let child;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => ready,
    isPortInUse: async () => false,
    spawnProcess: () => {
      spawnCount += 1;
      child = createChild(100 + spawnCount);
      ready = true;
      return child;
    },
  });
  supervisor.register(descriptor());

  const [first, second] = await Promise.all([
    supervisor.start("backend"),
    supervisor.start("backend"),
  ]);
  child.stdout.write("listening on 5005\n");

  assert.equal(spawnCount, 1);
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(supervisor.getState("backend").owned, true);
  assert.match(supervisor.getLogs("backend").at(-1).message, /listening/);
});

test("reports a deterministic conflict when the health port has another owner", async () => {
  let spawned = false;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => false,
    isPortInUse: async ({ host, port }) => {
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 5005);
      return true;
    },
    spawnProcess: () => {
      spawned = true;
      return createChild(200);
    },
  });
  supervisor.register(descriptor());

  await assert.rejects(
    supervisor.start("backend"),
    (error) =>
      error instanceof RuntimePortConflictError &&
      error.code === "RUNTIME_PORT_CONFLICT" &&
      /127\.0\.0\.1:5005/.test(error.message),
  );
  assert.equal(spawned, false);
  assert.equal(supervisor.getState("backend").status, "failed");
});

test("times out readiness and cleans up the owned process", async () => {
  let running = true;
  let terminatedPid = null;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => false,
    isPortInUse: async () => false,
    isProcessRunning: async () => running,
    spawnProcess: () => createChild(300),
    terminateProcessTree: async (pid, child) => {
      terminatedPid = pid;
      running = false;
      child.emit("close", 1, null);
    },
  });
  supervisor.register(descriptor({ startupTimeoutMs: 15 }));

  await assert.rejects(
    supervisor.start("backend"),
    (error) =>
      error instanceof RuntimeReadinessTimeoutError &&
      error.code === "RUNTIME_READINESS_TIMEOUT",
  );
  assert.equal(terminatedPid, 300);
  assert.equal(supervisor.getState("backend").owned, false);
  assert.equal(supervisor.getState("backend").status, "failed");
});

test("restarts with backoff after an unexpected ready-process exit", async () => {
  const children = [];
  let alive = false;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => alive,
    isPortInUse: async () => false,
    spawnProcess: () => {
      const child = createChild(400 + children.length);
      children.push(child);
      alive = true;
      return child;
    },
  });
  supervisor.register(descriptor());
  await supervisor.start("backend");

  alive = false;
  children[0].emit("close", 9, null);
  await waitFor(() => supervisor.getState("backend").status === "ready");

  assert.equal(children.length, 2);
  assert.equal(supervisor.getState("backend").restartAttempts, 1);
  assert.equal(supervisor.getState("backend").pid, 401);
  assert.equal(supervisor.getState("backend").lastExit.code, 9);
  assert.equal(supervisor.getState("backend").lastExit.expected, false);
});

test("explicit stop cancels restarts and verifies process and port release", async () => {
  let alive = false;
  let portInUse = false;
  let terminatedPid = null;
  const child = createChild(500);
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => alive,
    isPortInUse: async () => portInUse,
    isProcessRunning: async () => alive,
    spawnProcess: () => {
      alive = true;
      portInUse = true;
      return child;
    },
    terminateProcessTree: async (pid) => {
      terminatedPid = pid;
      alive = false;
      portInUse = false;
      child.emit("close", 0, null);
    },
  });
  supervisor.register(descriptor());
  await supervisor.start("backend");

  const state = await supervisor.stop("backend");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(terminatedPid, 500);
  assert.equal(state.status, "stopped");
  assert.equal(supervisor.getState("backend").pid, null);
  assert.equal(supervisor.getState("backend").owned, false);
  assert.equal(supervisor.getState("backend").lastExit.expected, true);
});

test("normalizes an IPv6 loopback endpoint before checking its port", async () => {
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => false,
    isPortInUse: async ({ host, port }) => {
      assert.equal(host, "::1");
      assert.equal(port, 5005);
      return true;
    },
  });
  supervisor.register(
    descriptor({ healthUrl: "http://[::1]:5005/health" }),
  );

  await assert.rejects(
    supervisor.start("backend"),
    (error) => error.code === "RUNTIME_PORT_CONFLICT",
  );
});

test("adopts an existing healthy service only when explicitly allowed", async () => {
  let spawned = false;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => true,
    spawnProcess: () => {
      spawned = true;
      return createChild(600);
    },
  });
  supervisor.register(descriptor({ allowExisting: true }));

  const state = await supervisor.start("backend");

  assert.equal(state.status, "ready");
  assert.equal(state.owned, false);
  assert.equal(state.pid, null);
  assert.equal(spawned, false);
  await supervisor.stop("backend");
});

test("stop wins a race with readiness and never leaves a late child", async () => {
  let releaseProbe;
  let spawned = false;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: () =>
      new Promise((resolve) => {
        releaseProbe = resolve;
      }),
    isPortInUse: async () => false,
    spawnProcess: () => {
      spawned = true;
      return createChild(700);
    },
  });
  supervisor.register(descriptor());

  const starting = supervisor.start("backend");
  await waitFor(() => typeof releaseProbe === "function");
  const stopped = await supervisor.stop("backend");
  releaseProbe(false);

  await assert.rejects(
    starting,
    (error) => error.code === "RUNTIME_START_CANCELLED",
  );
  assert.equal(stopped.status, "stopped");
  assert.equal(supervisor.getState("backend").status, "stopped");
  assert.equal(spawned, false);
});

test("stop cancels a spawned service that is still waiting for readiness", async () => {
  let probes = 0;
  let running = false;
  const child = createChild(800);
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => {
      probes += 1;
      return false;
    },
    isPortInUse: async () => false,
    isProcessRunning: async () => running,
    spawnProcess: () => {
      running = true;
      return child;
    },
    terminateProcessTree: async () => {
      running = false;
      child.emit("close", 0, null);
    },
  });
  supervisor.register(descriptor({ probeIntervalMs: 20 }));

  const starting = supervisor.start("backend");
  await waitFor(() => supervisor.getState("backend").pid === 800);
  await supervisor.stop("backend");

  await assert.rejects(
    starting,
    (error) => error.code === "RUNTIME_START_CANCELLED",
  );
  assert.equal(supervisor.getState("backend").status, "stopped");
  assert.ok(probes >= 1);
});

test("startAll tolerates optional failures but rejects required failures", async () => {
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => false,
    isPortInUse: async () => true,
  });
  supervisor.register(
    descriptor({ id: "optional-tts", required: false, restart: { enabled: false } }),
  );

  const optional = await supervisor.startAll();
  assert.equal(optional["optional-tts"].status, "failed");

  supervisor.register(
    descriptor({ id: "required-backend", restart: { enabled: false } }),
  );
  await assert.rejects(
    supervisor.startAll(),
    (error) =>
      error.code === "RUNTIME_PORT_CONFLICT" &&
      error.serviceId === "required-backend",
  );
});

test("repeated crash loops stop after the configured restart budget", async () => {
  const children = [];
  let alive = false;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => alive,
    isPortInUse: async () => false,
    spawnProcess: () => {
      const child = createChild(900 + children.length);
      children.push(child);
      alive = true;
      return child;
    },
  });
  supervisor.register(descriptor());
  await supervisor.start("backend");

  for (let index = 0; index < 2; index += 1) {
    alive = false;
    children[index].emit("close", 1, null);
    await waitFor(() => children.length === index + 2);
    await waitFor(() => supervisor.getState("backend").status === "ready");
  }
  alive = false;
  children[2].emit("close", 1, null);
  await waitFor(() => supervisor.getState("backend").status === "failed");

  assert.equal(children.length, 3);
  assert.equal(supervisor.getState("backend").restartAttempts, 2);
  assert.equal(
    supervisor.getState("backend").lastError.code,
    "RUNTIME_RESTART_EXHAUSTED",
  );
});

test("rejects invalid service descriptors before they can affect processes", () => {
  const supervisor = new RuntimeSupervisor({ logger: silentLogger() });

  assert.throws(
    () => supervisor.register(descriptor({ healthUrl: "not-a-url" })),
    /healthUrl must be a valid URL/,
  );
  assert.throws(
    () => supervisor.register(descriptor({ startupTimeoutMs: -1 })),
    /startupTimeoutMs must be a positive integer/,
  );
  assert.throws(
    () =>
      supervisor.register(
        descriptor({ restart: { enabled: true, maxAttempts: 1.5 } }),
      ),
    /maxAttempts must be a non-negative integer/,
  );
});

test("failed startup cleanup keeps ownership and reports shutdown failure", async () => {
  const child = createChild(1_000);
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: async () => false,
    isPortInUse: async () => false,
    isProcessRunning: async () => true,
    spawnProcess: () => child,
    terminateProcessTree: async () => {
      throw new Error("access denied");
    },
  });
  supervisor.register(
    descriptor({ startupTimeoutMs: 5, shutdownTimeoutMs: 5 }),
  );

  await assert.rejects(
    supervisor.start("backend"),
    (error) => error.code === "RUNTIME_SHUTDOWN_TIMEOUT",
  );
  assert.equal(supervisor.getState("backend").status, "failed");
  assert.equal(supervisor.getState("backend").owned, true);
  assert.equal(supervisor.getState("backend").pid, 1_000);
  await assert.rejects(
    supervisor.start("backend"),
    (error) => error.code === "RUNTIME_PROCESS_STILL_OWNED",
  );
});

test("a hung readiness probe still obeys the startup timeout", async () => {
  let running = true;
  const child = createChild(1_100);
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: () => new Promise(() => {}),
    isPortInUse: async () => false,
    isProcessRunning: async () => running,
    spawnProcess: () => child,
    terminateProcessTree: async () => {
      running = false;
      child.emit("close", 0, null);
    },
  });
  supervisor.register(descriptor({ startupTimeoutMs: 5 }));

  await assert.rejects(
    supervisor.start("backend"),
    (error) => error.code === "RUNTIME_READINESS_TIMEOUT",
  );
  assert.equal(supervisor.getState("backend").owned, false);
});

test("stop during an in-flight restart remains stopped", async () => {
  const children = [];
  let alive = false;
  let restartProbePending = false;
  let releaseRestartProbe;
  const supervisor = new RuntimeSupervisor({
    logger: silentLogger(),
    probeService: () => {
      if (restartProbePending) {
        return new Promise((resolve) => {
          releaseRestartProbe = resolve;
        });
      }
      return alive;
    },
    isPortInUse: async () => false,
    spawnProcess: () => {
      const child = createChild(1_200 + children.length);
      children.push(child);
      alive = true;
      return child;
    },
  });
  supervisor.register(descriptor());
  await supervisor.start("backend");

  restartProbePending = true;
  alive = false;
  children[0].emit("close", 1, null);
  await waitFor(() => typeof releaseRestartProbe === "function");
  await supervisor.stop("backend");
  releaseRestartProbe(false);
  await waitFor(() => supervisor.getState("backend").status === "stopped");

  assert.equal(children.length, 1);
  assert.equal(supervisor.getState("backend").lastError, null);
});
