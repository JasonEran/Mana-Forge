const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ORIGIN = "mana-app://app";
const APP_SCHEME = "mana-app";

const APP_ALLOWED_PATHS = [
  /^avatar\/(?:index\.html|renderer\.js|ring-visualizer\.js)$/,
  /^renderer\/(?:index\.html|renderer\.js|doctor-panel\.js|reply-emotion\.js|vision-hotkey\.js|voice-endpointing\.js)$/,
];

function resolveProtocolPath(options) {
  const { requestUrl, expectedHost, rootDir, allowedPath, fsImpl = fs } = options;
  const url = new URL(requestUrl);
  if (url.hostname !== expectedHost || url.username || url.password) {
    throw new TypeError("Protocol host is not allowed.");
  }
  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch (error) {
    throw new TypeError("Protocol path is invalid.");
  }
  if (!relativePath || relativePath.includes("\0")) {
    throw new TypeError("Protocol path is invalid.");
  }
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (allowedPath && !allowedPath(normalizedPath)) {
    throw new TypeError("Protocol path is not allowed.");
  }

  const resolvedRoot = fsImpl.realpathSync(path.resolve(rootDir));
  const candidate = path.resolve(resolvedRoot, normalizedPath);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new TypeError("Protocol path escapes its root.");
  }
  if (!fsImpl.existsSync(candidate) || !fsImpl.statSync(candidate).isFile()) {
    throw new TypeError("Protocol file does not exist.");
  }
  const realCandidate = fsImpl.realpathSync(candidate);
  const realRelative = path.relative(resolvedRoot, realCandidate);
  if (
    realRelative.startsWith(`..${path.sep}`) ||
    realRelative === ".." ||
    path.isAbsolute(realRelative)
  ) {
    throw new TypeError("Protocol file escapes its root.");
  }
  return realCandidate;
}

function createProtocolHandler(options) {
  const { expectedHost, rootProvider, allowedPath, net } = options;
  return async function handleProtocol(request) {
    try {
      const filePath = resolveProtocolPath({
        requestUrl: request.url,
        expectedHost,
        rootDir: rootProvider(),
        allowedPath,
      });
      return await net.fetch(pathToFileURL(filePath).href);
    } catch (error) {
      return new Response("Not found", { status: 404 });
    }
  };
}

function appPathAllowed(relativePath) {
  return APP_ALLOWED_PATHS.some((pattern) => pattern.test(relativePath));
}

function registerPrivilegedSchemes(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function installLocalProtocols({ protocol, net, appRoot }) {
  protocol.handle(
    APP_SCHEME,
    createProtocolHandler({
      expectedHost: "app",
      rootProvider: () => appRoot,
      allowedPath: appPathAllowed,
      net,
    }),
  );
}

module.exports = {
  APP_ORIGIN,
  APP_SCHEME,
  appPathAllowed,
  installLocalProtocols,
  registerPrivilegedSchemes,
  resolveProtocolPath,
};
