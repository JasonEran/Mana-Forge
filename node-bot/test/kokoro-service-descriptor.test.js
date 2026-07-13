const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createKokoroServiceDescriptor,
} = require("../../runtime/services/kokoro");

const repoRoot = path.resolve("C:\\Mana");

function installedFs() {
  return { existsSync: () => true };
}

function missingFs() {
  return { existsSync: () => false };
}

test("installed Kokoro uses its local Python runtime and configured port", () => {
  const descriptor = createKokoroServiceDescriptor({
    repoRoot,
    fsImpl: installedFs(),
    env: {
      KOKORO_TTS_URL: "http://127.0.0.1:5511",
      MANA_KOKORO_STARTUP_TIMEOUT_MS: "45000",
      MANA_KOKORO_SHUTDOWN_TIMEOUT_MS: "9000",
    },
  });

  assert.equal(
    descriptor.command,
    path.join(repoRoot, "tts-service", "venv", "Scripts", "python.exe"),
  );
  assert.deepEqual(descriptor.args, [
    "-m",
    "uvicorn",
    "kokoro_service:app",
    "--host",
    "127.0.0.1",
    "--port",
    "5511",
  ]);
  assert.equal(descriptor.healthUrl, "http://127.0.0.1:5511/health");
  assert.equal(descriptor.env.KOKORO_PORT, "5511");
  assert.equal(descriptor.env.KOKORO_HOST, "127.0.0.1");
  assert.equal(descriptor.required, true);
  assert.equal(descriptor.startupTimeoutMs, 45000);
  assert.equal(descriptor.shutdownTimeoutMs, 9000);
});

test("missing Kokoro assets use the compatibility setup script", () => {
  const descriptor = createKokoroServiceDescriptor({
    repoRoot,
    fsImpl: missingFs(),
    env: {},
  });

  assert.equal(descriptor.command, "powershell");
  assert.deepEqual(descriptor.args, [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(repoRoot, "tts-service", "start_kokoro.ps1"),
  ]);
  assert.equal(descriptor.env.KOKORO_PORT, "5011");
  assert.equal(descriptor.env.KOKORO_HOST, "127.0.0.1");
  assert.equal(descriptor.startupTimeoutMs, 600000);
});

test("Kokoro descriptor normalizes health and validates local ownership", () => {
  const descriptor = createKokoroServiceDescriptor({
    fsImpl: installedFs(),
    env: { KOKORO_TTS_URL: "http://localhost:5011/health?token=hidden" },
  });
  assert.equal(descriptor.healthUrl, "http://localhost:5011/health");

  const ipv6 = createKokoroServiceDescriptor({
    fsImpl: installedFs(),
    env: { KOKORO_TTS_URL: "http://[::1]:5011" },
  });
  assert.equal(ipv6.env.KOKORO_HOST, "::1");
  assert.equal(ipv6.args[4], "::1");

  for (const url of [
    "https://127.0.0.1:5011",
    "http://kokoro.example.com:5011",
    "http://user:password@127.0.0.1:5011",
    "http://127.0.0.1:5011/api",
  ]) {
    assert.throws(
      () =>
        createKokoroServiceDescriptor({
          fsImpl: installedFs(),
          env: { KOKORO_TTS_URL: url },
        }),
      /KOKORO_TTS_URL/,
    );
  }
});

test("Kokoro descriptor rejects invalid lifecycle timeouts", () => {
  assert.throws(
    () =>
      createKokoroServiceDescriptor({
        fsImpl: installedFs(),
        env: { MANA_KOKORO_SHUTDOWN_TIMEOUT_MS: "never" },
      }),
    /MANA_KOKORO_SHUTDOWN_TIMEOUT_MS must be a positive integer/,
  );
});
