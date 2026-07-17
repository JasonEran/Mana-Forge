const fs = require("node:fs");
const path = require("node:path");
const { findModelJson } = require("./live2d-logic");
const { AVATAR_ORIGIN } = require("../local-protocol");

const TUNING_NAMES = Object.freeze([
  "MANA_AVATAR_FPS",
  "MANA_LIVE2D_BROW_PARAMS",
  "MANA_LIVE2D_EYE_BLINK_PARAMS",
  "MANA_LIVE2D_EYE_OPEN_SCALE",
  "MANA_LIVE2D_IDLE_MAX_PITCH_DEG",
  "MANA_LIVE2D_IDLE_TILT_DEG",
  "MANA_LIVE2D_MOUTH_GAIN",
  "MANA_LIVE2D_MOUTH_PARAM",
  "MANA_LIVE2D_SMILE_PARAMS",
  "MANA_LIVE2D_STATE_EXPRESSIONS",
  "MANA_LIVE2D_STATE_MOTIONS",
]);

function assertInsideRoot(rootDir, candidate, label) {
  const relative = path.relative(rootDir, candidate);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    if (!relative) return;
    throw new TypeError(`${label} escapes the model directory.`);
  }
}

function assertRealPathInsideRoot(rootDir, candidate, label, fsImpl = fs) {
  if (!fsImpl.existsSync(candidate)) {
    throw new TypeError(`${label} does not exist.`);
  }
  const realRoot = fsImpl.realpathSync(rootDir);
  const realCandidate = fsImpl.realpathSync(candidate);
  assertInsideRoot(realRoot, realCandidate, label);
}

function collectReferencedFiles(settings) {
  const refs = settings?.FileReferences || {};
  const values = [];
  for (const key of ["Moc", "Physics", "Pose", "UserData", "DisplayInfo"] ) {
    if (typeof refs[key] === "string") values.push(refs[key]);
  }
  if (Array.isArray(refs.Textures)) values.push(...refs.Textures);
  for (const motionGroup of Object.values(refs.Motions || {})) {
    for (const motion of Array.isArray(motionGroup) ? motionGroup : []) {
      if (typeof motion?.File === "string") values.push(motion.File);
      if (typeof motion?.Sound === "string") values.push(motion.Sound);
    }
  }
  for (const expression of Array.isArray(refs.Expressions) ? refs.Expressions : []) {
    if (typeof expression?.File === "string") values.push(expression.File);
  }
  return values;
}

function assertSafeRelativeReference(value) {
  const reference = String(value || "");
  if (
    !reference ||
    path.isAbsolute(reference) ||
    reference.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
    reference.startsWith("/") ||
    reference.includes("\0")
  ) {
    throw new TypeError("Avatar model references must be safe relative URLs.");
  }
}

function listFilesRecursively(rootDir, fsImpl = fs) {
  if (!fsImpl.existsSync(rootDir)) return [];
  const found = [];
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else found.push(path.relative(rootDir, absolute).replace(/\\/g, "/"));
    }
  }
  return found.sort();
}

function loadOptionalJson(candidates, fsImpl = fs) {
  for (const candidate of candidates) {
    if (!fsImpl.existsSync(candidate)) continue;
    return JSON.parse(fsImpl.readFileSync(candidate, "utf8"));
  }
  return null;
}

function loadAvatarBootstrap(options = {}) {
  const fsImpl = options.fs || fs;
  const env = options.env || process.env;
  const defaultModelDir = path.resolve(
    options.defaultModelDir || path.join(__dirname, "model"),
  );
  const live2dCorePath = path.resolve(
    options.live2dCorePath ||
      path.join(__dirname, "..", "assets", "live2d", "live2dcubismcore.min.js"),
  );
  const { modelJson } = resolveAvatarModel({ defaultModelDir, env, fs: fsImpl });
  if (!modelJson || !fsImpl.existsSync(modelJson)) return { available: false };

  const modelDir = path.dirname(modelJson);
  assertRealPathInsideRoot(modelDir, modelJson, "Avatar model", fsImpl);
  const settings = JSON.parse(fsImpl.readFileSync(modelJson, "utf8"));
  for (const relativePath of collectReferencedFiles(settings)) {
    assertSafeRelativeReference(relativePath);
    assertInsideRoot(
      modelDir,
      path.resolve(modelDir, relativePath),
      "Avatar model reference",
    );
    assertRealPathInsideRoot(
      modelDir,
      path.resolve(modelDir, relativePath),
      "Avatar model reference",
      fsImpl,
    );
  }

  const files = listFilesRecursively(modelDir, fsImpl);
  const tuning = {};
  for (const name of TUNING_NAMES) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      tuning[name] = String(env[name]);
    }
  }

  return {
    available: true,
    avatarConfig: loadOptionalJson(
      [
        path.join(modelDir, "mana-avatar.json"),
        path.join(defaultModelDir, "mana-avatar.json"),
      ],
      fsImpl,
    ),
    expressionFiles: files.filter((name) => name.toLowerCase().endsWith(".exp3.json")),
    modelUrl: `${AVATAR_ORIGIN}/${encodeURIComponent(path.basename(modelJson))}`,
    motionFiles: files.filter((name) => name.toLowerCase().endsWith(".motion3.json")),
    settings,
    tuning,
    runtimeAvailable: fsImpl.existsSync(live2dCorePath),
  };
}

function resolveAvatarModel(options = {}) {
  const fsImpl = options.fs || fs;
  const env = options.env || process.env;
  const defaultModelDir = path.resolve(
    options.defaultModelDir || path.join(__dirname, "model"),
  );
  const explicitModel = String(env.MANA_LIVE2D_MODEL || "").trim();
  const modelJson = explicitModel
    ? path.resolve(explicitModel)
    : findModelJson(defaultModelDir, fsImpl);
  return {
    defaultModelDir,
    modelDir: modelJson ? path.dirname(modelJson) : defaultModelDir,
    modelJson,
  };
}

module.exports = {
  TUNING_NAMES,
  assertSafeRelativeReference,
  loadAvatarBootstrap,
  resolveAvatarModel,
};
