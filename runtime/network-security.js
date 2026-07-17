const net = require("node:net");

const DEFAULT_BACKEND_HOST = "127.0.0.1";
const DEFAULT_ALLOWED_ORIGINS = Object.freeze(["mana-app://app"]);

function parseBooleanFlag(value, name) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false") return false;
  if (normalized === "1" || normalized === "true") return true;
  throw new TypeError(`${name} must be 0 or 1.`);
}

function normalizeHost(value) {
  const host = String(value || DEFAULT_BACKEND_HOST).trim();
  const unwrapped = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  if (unwrapped.toLowerCase() === "localhost") return "localhost";
  if (!net.isIP(unwrapped)) {
    throw new TypeError(
      "MANA_BACKEND_HOST must be localhost or an IPv4/IPv6 address.",
    );
  }
  return unwrapped;
}

function isLoopbackAddress(value) {
  let address = String(value || "").trim().toLowerCase();
  if (!address) return false;
  if (address === "localhost") return true;
  if (address.startsWith("[") && address.endsWith("]")) {
    address = address.slice(1, -1);
  }
  const zoneIndex = address.indexOf("%");
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex);
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (address === "::1") return true;
  return net.isIP(address) === 4 && address.startsWith("127.");
}

function parseAllowedOrigins(value) {
  const configured = String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);

  for (const origin of configured) {
    if (origin === "*") {
      throw new TypeError("MANA_CORS_ALLOWED_ORIGINS must not contain a wildcard.");
    }
    if (DEFAULT_ALLOWED_ORIGINS.includes(origin)) {
      allowed.add(origin);
      continue;
    }

    let parsed;
    try {
      parsed = new URL(origin);
    } catch (error) {
      throw new TypeError(
        `MANA_CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`,
      );
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new TypeError(
        "MANA_CORS_ALLOWED_ORIGINS supports only HTTP and HTTPS origins.",
      );
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError(
        "MANA_CORS_ALLOWED_ORIGINS must contain origins without paths, credentials, queries, or fragments.",
      );
    }
    allowed.add(parsed.origin);
  }

  return [...allowed];
}

function validateRemoteMobileAuth(env) {
  const parts = String(env.MOBILE_PASSCODE_HASH || "").split("$");
  const iterations = Number(parts[1]);
  const validPasscodeHash =
    parts.length === 4 &&
    parts[0] === "pbkdf2_sha256" &&
    Number.isSafeInteger(iterations) &&
    iterations >= 120_000 &&
    parts[2].length >= 16 &&
    /^[a-f0-9]{64}$/i.test(parts[3]);
  if (!validPasscodeHash) {
    throw new TypeError(
      "Remote access requires a valid MOBILE_PASSCODE_HASH with at least 120000 PBKDF2 iterations.",
    );
  }

  const sessionSecret = String(env.MOBILE_SESSION_SECRET || "");
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    throw new TypeError(
      "Remote access requires MOBILE_SESSION_SECRET to contain at least 32 bytes.",
    );
  }
}

function createNetworkSecurityConfig(env = process.env) {
  const host = normalizeHost(env.MANA_BACKEND_HOST);
  const remoteAccessRequested = parseBooleanFlag(
    env.MANA_ALLOW_REMOTE_ACCESS,
    "MANA_ALLOW_REMOTE_ACCESS",
  );
  const lanBindingEnabled = !isLoopbackAddress(host);

  if (lanBindingEnabled && !remoteAccessRequested) {
    throw new TypeError(
      "Non-loopback MANA_BACKEND_HOST requires MANA_ALLOW_REMOTE_ACCESS=1.",
    );
  }
  if (remoteAccessRequested) validateRemoteMobileAuth(env);

  return Object.freeze({
    host,
    lanBindingEnabled,
    remoteAccessEnabled: remoteAccessRequested,
    remoteAccessRequested,
    allowedOrigins: Object.freeze(
      parseAllowedOrigins(env.MANA_CORS_ALLOWED_ORIGINS),
    ),
  });
}

function createCorsOptions(networkSecurity) {
  const allowedOrigins = new Set(networkSecurity.allowedOrigins);
  return {
    allowedHeaders: ["Authorization", "Content-Type", "X-Admin-Token"],
    maxAge: 600,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  };
}

function createOriginGuard(networkSecurity) {
  const allowedOrigins = new Set(networkSecurity.allowedOrigins);
  return function originGuard(req, res, next) {
    const origin = readHeader(req, "origin");
    if (!origin || allowedOrigins.has(origin)) return next();
    try {
      const forwardedHost = String(readHeader(req, "x-forwarded-host") || "")
        .split(",")[0]
        .trim();
      const requestHost = forwardedHost || String(readHeader(req, "host") || "");
      if (new URL(origin).host === requestHost) {
        return next();
      }
    } catch (error) {
      // Invalid origins are rejected by the response below.
    }
    return res.status(403).json({
      ok: false,
      error: "origin_not_allowed",
    });
  };
}

function isMobileGatewayPath(pathname) {
  return pathname === "/mobile" || pathname.startsWith("/mobile/");
}

function readHeader(req, name) {
  if (typeof req.get === "function") return req.get(name);
  const headers = req.headers || {};
  return headers[name.toLowerCase()] || headers[name];
}

function isLoopbackHostHeader(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  try {
    return isLoopbackAddress(new URL(`http://${raw}`).hostname);
  } catch (error) {
    return false;
  }
}

function isRemoteRequest(req) {
  const remoteAddress =
    req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip;
  if (!isLoopbackAddress(remoteAddress)) return true;

  const proxyHeaders = [
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-real-ip",
    "cf-connecting-ip",
  ];
  if (proxyHeaders.some((name) => String(readHeader(req, name) || "").trim())) {
    return true;
  }
  return !isLoopbackHostHeader(readHeader(req, "host"));
}

function createRemoteAccessGuard(networkSecurity = createNetworkSecurityConfig()) {
  return function remoteAccessGuard(req, res, next) {
    if (!isRemoteRequest(req)) return next();
    if (!networkSecurity.remoteAccessEnabled) {
      return res.status(403).json({
        ok: false,
        error: "remote_access_disabled",
      });
    }
    if (isMobileGatewayPath(req.path || "")) return next();
    return res.status(403).json({
      ok: false,
      error: "remote_core_access_denied",
    });
  };
}

function createWebSocketVerifier(networkSecurity = createNetworkSecurityConfig()) {
  const allowedOrigins = new Set(networkSecurity.allowedOrigins);
  return function verifyClient(info, done) {
    const origin = info?.origin || readHeader(info?.req || {}, "origin");
    if (origin && !allowedOrigins.has(origin)) {
      done(false, 403, "WebSocket origin is not allowed");
      return;
    }
    if (!isRemoteRequest(info?.req || {})) {
      done(true);
      return;
    }
    done(false, 403, "Remote WebSocket access is disabled");
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_BACKEND_HOST,
  createCorsOptions,
  createNetworkSecurityConfig,
  createOriginGuard,
  createRemoteAccessGuard,
  createWebSocketVerifier,
  isLoopbackAddress,
  isRemoteRequest,
  parseAllowedOrigins,
};
