const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCapabilityHealth,
  registerCapabilities,
} = require("../capabilities/registry");

test("registerCapabilities calls route registration for each routed capability", () => {
  const calls = [];
  const app = { name: "app" };
  const context = { value: 42 };
  const capabilities = [
    {
      key: "alpha",
      registerRoutes: (receivedApp, receivedContext) => {
        calls.push({ key: "alpha", receivedApp, receivedContext });
      },
    },
    {
      key: "statusOnly",
      getHealth: () => ({ status: "configured" }),
    },
    {
      key: "beta",
      registerRoutes: (receivedApp, receivedContext) => {
        calls.push({ key: "beta", receivedApp, receivedContext });
      },
    },
  ];

  registerCapabilities(app, capabilities, context);

  assert.deepEqual(
    calls.map((call) => call.key),
    ["alpha", "beta"],
  );
  assert.equal(calls[0].receivedApp, app);
  assert.equal(calls[0].receivedContext, context);
});

test("buildCapabilityHealth collects health by capability key", () => {
  const context = { ready: true };
  const health = buildCapabilityHealth(
    [
      {
        key: "alpha",
        getHealth: (receivedContext) => ({
          status: receivedContext.ready ? "available" : "unavailable",
          configured: true,
          message: "Alpha is available.",
        }),
      },
      {
        key: "routesOnly",
        registerRoutes: () => {},
      },
    ],
    context,
  );

  assert.deepEqual(health, {
    alpha: {
      enabled: true,
      status: "available",
      configured: true,
      message: "Alpha is available.",
    },
  });
});

test("registry neither registers nor probes a disabled capability", () => {
  let routeCalls = 0;
  let healthCalls = 0;
  const capability = {
    key: "alpha",
    registerRoutes: () => {
      routeCalls += 1;
    },
    getHealth: () => {
      healthCalls += 1;
      return { status: "available" };
    },
  };
  const context = {
    capabilityManifest: {
      capabilities: {
        alpha: { key: "alpha", label: "Alpha", enabled: false },
      },
    },
  };

  registerCapabilities({}, [capability], context);
  const health = buildCapabilityHealth([capability], context);

  assert.equal(routeCalls, 0);
  assert.equal(healthCalls, 0);
  assert.deepEqual(health.alpha, {
    status: "disabled",
    configured: false,
    enabled: false,
    message: "Alpha is disabled.",
  });
});

test("registry rejects capabilities without stable keys", () => {
  assert.throws(
    () => registerCapabilities({}, [{ registerRoutes: () => {} }], {}),
    /capability key is required/,
  );
  assert.throws(
    () => buildCapabilityHealth([{ key: "   ", getHealth: () => ({}) }], {}),
    /capability key is required/,
  );
});
