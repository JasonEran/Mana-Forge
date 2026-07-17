const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_ORIGIN = "mana-app://app";
const APP_SCHEME = "mana-app";
const AVATAR_ORIGIN = "mana-avatar://model";
const AVATAR_SCHEME = "mana-avatar";

const APP_ALLOWED_PATHS = [
  /^assets\/avatar\/(?:idle|talking)\.(?:png|svg)$/,
  /^assets\/live2d\/live2dcubismcore\.min\.js$/,
  /^avatar\/(?:index\.html|live2d-avatar\.js|live2d-logic\.js|renderer\.js)$/,
  /^renderer\/(?:index\.html|renderer\.js|doctor-panel\.js|reply-emotion\.js|vision-hotkey\.js|voice-endpointing\.js)$/,
  /^node_modules\/pixi\.js\/dist\/browser\/pixi\.min\.js$/,
  /^node_modules\/pixi-live2d-display\/dist\/cubism4\.min\.js$/,
];
const AVATAR_ALLOWED_EXTENSIONS = new Set([
  ".json",
  ".moc3",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".wav",
  ".mp3",
  ".ogg",
]);

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
  const { expectedHost, rootProvider, allowedPath, corsOrigin, net } = options;
  return async function handleProtocol(request) {
    try {
      const filePath = resolveProtocolPath({
        requestUrl: request.url,
        expectedHost,
        rootDir: rootProvider(),
        allowedPath,
      });
      const response = await net.fetch(pathToFileURL(filePath).href);
      if (!corsOrigin) return response;
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", corsOrigin);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      return new Response("Not found", { status: 404 });
    }
  };
}

function appPathAllowed(relativePath) {
  return APP_ALLOWED_PATHS.some((pattern) => pattern.test(relativePath));
}

function avatarPathAllowed(relativePath) {
  return AVATAR_ALLOWED_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
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
    {
      scheme: AVATAR_SCHEME,
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

function installLocalProtocols({ protocol, net, appRoot, avatarRoot }) {
  protocol.handle(
    APP_SCHEME,
    createProtocolHandler({
      expectedHost: "app",
      rootProvider: () => appRoot,
      allowedPath: appPathAllowed,
      net,
    }),
  );
  protocol.handle(
    AVATAR_SCHEME,
    createProtocolHandler({
      expectedHost: "model",
      rootProvider: avatarRoot,
      allowedPath: avatarPathAllowed,
      corsOrigin: APP_ORIGIN,
      net,
    }),
  );
}

module.exports = {
  APP_ORIGIN,
  APP_SCHEME,
  AVATAR_ORIGIN,
  AVATAR_SCHEME,
  appPathAllowed,
  avatarPathAllowed,
  installLocalProtocols,
  registerPrivilegedSchemes,
  resolveProtocolPath,
};
