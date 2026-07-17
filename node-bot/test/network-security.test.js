const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  createNetworkSecurityConfig,
  createRemoteAccessGuard,
  createWebSocketVerifier,
  isLoopbackAddress,
} = require("../../runtime/network-security");
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

function invokeGuard(guard, { address, path }) {
  const result = { status: null, body: null, nextCalls: 0 };
  const req = {
    path,
    headers: {},
    socket: { remoteAddress: address },
  };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  guard(req, res, () => {
    result.nextCalls += 1;
  });
  return result;
}

test("network security defaults to a loopback-only backend", () => {
  const config = createNetworkSecurityConfig({});

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.remoteAccessEnabled, false);
  assert.equal(config.lanBindingEnabled, false);
  assert.deepEqual(config.allowedOrigins, ["mana-app://app"]);
});

test("remote binding requires an explicit flag and configured mobile auth", () => {
  assert.throws(
    () => createNetworkSecurityConfig({ MANA_BACKEND_HOST: "0.0.0.0" }),
    /MANA_ALLOW_REMOTE_ACCESS=1/,
  );
  assert.throws(
    () =>
      createNetworkSecurityConfig({
        MANA_BACKEND_HOST: "0.0.0.0",
        MANA_ALLOW_REMOTE_ACCESS: "1",
      }),
    /valid MOBILE_PASSCODE_HASH/,
  );
  assert.throws(
    () =>
      createNetworkSecurityConfig({
        MANA_BACKEND_HOST: "0.0.0.0",
        MANA_ALLOW_REMOTE_ACCESS: "1",
        MOBILE_PASSCODE_HASH:
          "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        MOBILE_SESSION_SECRET: "too-short",
      }),
    /at least 32 bytes/,
  );

  const config = createNetworkSecurityConfig({
    MANA_BACKEND_HOST: "0.0.0.0",
    MANA_ALLOW_REMOTE_ACCESS: "1",
    MOBILE_PASSCODE_HASH:
      "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    MOBILE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    MANA_CORS_ALLOWED_ORIGINS:
      "https://phone.example.test, http://127.0.0.1:4173",
  });

  assert.equal(config.remoteAccessEnabled, true);
  assert.deepEqual(config.allowedOrigins, [
    "mana-app://app",
    "https://phone.example.test",
    "http://127.0.0.1:4173",
  ]);
});

test("network security rejects ambiguous flags, wildcard CORS, and URL paths", () => {
  assert.throws(
    () => createNetworkSecurityConfig({ MANA_ALLOW_REMOTE_ACCESS: "yes" }),
    /must be 0 or 1/,
  );
  assert.throws(
    () => createNetworkSecurityConfig({ MANA_CORS_ALLOWED_ORIGINS: "*" }),
    /must not contain a wildcard/,
  );
  assert.throws(
    () =>
      createNetworkSecurityConfig({
        MANA_CORS_ALLOWED_ORIGINS: "https://example.test/app",
      }),
    /must contain origins without paths/,
  );
});

test("loopback detection handles IPv4, IPv6, and mapped socket addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.20"), false);
  assert.equal(isLoopbackAddress("::ffff:192.168.1.20"), false);
});

test("non-loopback HTTP clients can reach only the mobile gateway", () => {
  const disabledGuard = createRemoteAccessGuard(
    createNetworkSecurityConfig({}),
  );
  const guard = createRemoteAccessGuard(
    createNetworkSecurityConfig({
      MANA_ALLOW_REMOTE_ACCESS: "1",
      MOBILE_PASSCODE_HASH:
        "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MOBILE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    }),
  );

  assert.deepEqual(
    invokeGuard(disabledGuard, {
      address: "192.168.1.20",
      path: "/mobile/health",
    }),
    {
      status: 403,
      body: { ok: false, error: "remote_access_disabled" },
      nextCalls: 0,
    },
  );

  assert.deepEqual(
    invokeGuard(guard, { address: "192.168.1.20", path: "/health" }),
    {
      status: 403,
      body: { ok: false, error: "remote_core_access_denied" },
      nextCalls: 0,
    },
  );
  assert.equal(
    invokeGuard(guard, {
      address: "192.168.1.20",
      path: "/mobile/auth/unlock",
    }).nextCalls,
    1,
  );
  assert.equal(
    invokeGuard(guard, { address: "127.0.0.1", path: "/admin/retriever" })
      .nextCalls,
    1,
  );
});

test("proxy and tunnel headers cannot disguise remote core requests as local", () => {
  const guard = createRemoteAccessGuard(
    createNetworkSecurityConfig({
      MANA_ALLOW_REMOTE_ACCESS: "1",
      MOBILE_PASSCODE_HASH:
        "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      MOBILE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    }),
  );
  const req = {
    path: "/health",
    headers: {
      host: "mana.example.test",
      "cf-connecting-ip": "203.0.113.10",
    },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const result = { status: null, body: null, nextCalls: 0 };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  guard(req, res, () => {
    result.nextCalls += 1;
  });

  assert.deepEqual(result, {
    status: 403,
    body: { ok: false, error: "remote_core_access_denied" },
    nextCalls: 0,
  });
  req.path = "/mobile/health";
  guard(req, res, () => {
    result.nextCalls += 1;
  });
  assert.equal(result.nextCalls, 1);
});

test("caption and tray WebSockets reject remote clients and hostile origins", () => {
  const verifyClient = createWebSocketVerifier(
    createNetworkSecurityConfig({}),
  );
  const decisions = [];

  verifyClient(
    {
      origin: "https://evil.example.test",
      req: {
        headers: { host: "127.0.0.1:5005" },
        socket: { remoteAddress: "127.0.0.1" },
      },
    },
    (...args) => decisions.push(args),
  );
  verifyClient(
    { req: { socket: { remoteAddress: "192.168.1.20" } } },
    (...args) => decisions.push(args),
  );
  verifyClient(
    {
      req: {
        headers: { host: "127.0.0.1:5005" },
        socket: { remoteAddress: "::1" },
      },
    },
    (...args) => decisions.push(args),
  );

  assert.deepEqual(decisions, [
    [false, 403, "WebSocket origin is not allowed"],
    [false, 403, "Remote WebSocket access is disabled"],
    [true],
  ]);
});

test("CORS returns headers only for trusted exact origins", async () => {
  const env = {
    MANA_CORS_ALLOWED_ORIGINS: "https://trusted.example.test",
  };
  const app = createApp({ env });

  await withServer(app, async (baseUrl) => {
    const trusted = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://trusted.example.test" },
    });
    const untrusted = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "https://evil.example.test" },
    });
    const electron = await fetch(`${baseUrl}/health`, {
      headers: { Origin: "mana-app://app" },
    });

    assert.equal(
      trusted.headers.get("access-control-allow-origin"),
      "https://trusted.example.test",
    );
    assert.equal(untrusted.status, 403);
    assert.deepEqual(await untrusted.json(), {
      ok: false,
      error: "origin_not_allowed",
    });
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
    assert.equal(
      electron.headers.get("access-control-allow-origin"),
      "mana-app://app",
    );
    assert.match(trusted.headers.get("vary") || "", /Origin/);
  });
});

test("a tunneled mobile PWA may call its own exact public origin", async () => {
  const env = {
    MANA_ALLOW_REMOTE_ACCESS: "1",
    MOBILE_PASSCODE_HASH:
      "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    MOBILE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  };
  const app = createApp({ env });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/mobile/health`, {
      headers: {
        Origin: "https://mana.example.test",
        "CF-Connecting-IP": "203.0.113.10",
        "X-Forwarded-Host": "mana.example.test",
      },
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  });
});

test("tunneled mobile administration still requires ADMIN_TOKEN", async () => {
  const env = {
    MANA_ALLOW_REMOTE_ACCESS: "1",
    MOBILE_PASSCODE_HASH:
      "pbkdf2_sha256$120000$1234567890abcdef$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    MOBILE_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  };
  const app = createApp({ env });

  await withServer(app, async (baseUrl) => {
    const headers = {
      Host: "mana.example.test",
      "CF-Connecting-IP": "203.0.113.10",
    };
    const denied = await fetch(`${baseUrl}/mobile/pair/request`, {
      method: "POST",
      headers,
    });

    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "admin-only" });
  });
});
