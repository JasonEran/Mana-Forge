const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { createApp } = require("../server");

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health includes component readiness while preserving top-level fields", async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.ttsConfigured, "boolean");
    assert.equal(typeof body.llamaConfigured, "boolean");
    assert.equal(typeof body.remoteAiEnabled, "boolean");

    assert.deepEqual(Object.keys(body.components).sort(), [
      "backend",
      "cloudflareTunnel",
      "dirScanner",
      "ffxivMarket",
      "localLlama",
      "localMemory",
      "mobileAuth",
      "tts",
      "vtubeStudio",
      "webAccess",
      "whisper",
    ]);
    assert.equal(body.components.backend.status, "available");
    assert.equal(body.components.backend.configured, true);
    assert.deepEqual(body.components.ffxivMarket, {
      status: "configured",
      configured: true,
      message: "FFXIV market providers are configured from local defaults.",
      universalisConfigured: true,
      xivapiConfigured: true,
    });
    assert.equal(typeof body.components.localLlama.message, "string");
  });
});

test("health never installs routes during a request", async () => {
  const app = createApp({ env: { MANA_ADMIN_SECRET: "test-secret" } });
  const initialStackLength = app._router.stack.length;

  await withServer(app, async (baseUrl) => {
    const debugBeforeHealth = await fetch(`${baseUrl}/debug/intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(debugBeforeHealth.status, 400);

    const adminBeforeHealth = await fetch(
      `${baseUrl}/admin/pending-writes`,
    );
    assert.equal(adminBeforeHealth.status, 401);

    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${baseUrl}/health`);
      assert.equal(response.status, 200);
    }
  });

  assert.equal(app._router.stack.length, initialStackLength);
});

test("health component details do not expose secret values", async () => {
  const app = createApp({
    env: {
      MOBILE_PASSCODE_HASH: "secret-passcode-hash",
      MOBILE_SESSION_SECRET: "secret-session-value",
      CLOUDFLARE_TUNNEL_TOKEN: "secret-cloudflare-token",
      VTUBE_STUDIO_ENABLED: "1",
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json();
    const raw = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(body.components.mobileAuth.status, "available");
    assert.equal(body.components.cloudflareTunnel.status, "configured");
    assert.equal(body.components.vtubeStudio.status, "configured");
    assert.equal(raw.includes("secret-passcode-hash"), false);
    assert.equal(raw.includes("secret-session-value"), false);
    assert.equal(raw.includes("secret-cloudflare-token"), false);
  });
});
