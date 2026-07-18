const IPC_CHANNELS = Object.freeze({
  AVATAR_MOUTH: "avatar:set-mouth",
  AVATAR_MOUTH_CHANGED: "avatar:mouth",
  AVATAR_STATE: "avatar:set-state",
  AVATAR_STATE_CHANGED: "avatar:state",
  OPEN_LOCAL_WEB_UI: "external:open-local-web-ui",
  RENDERER_CONFIG: "renderer:get-config",
  SCREEN_CAPTURE_PRIMARY: "screen:capture-primary",
  VISION_HOTKEY: "vision:hotkey",
});

const AVATAR_STATES = new Set([
  "idle",
  "talking",
  "excited",
  "angry",
  "sad",
  "disgusted",
]);
const LOCAL_WEB_UI_URL = "http://127.0.0.1:7860/";

function normalizeAvatarState(value) {
  const state = String(value || "");
  if (!AVATAR_STATES.has(state)) {
    throw new TypeError("Invalid avatar state.");
  }
  return state;
}

function normalizeMouthRms(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Invalid mouth RMS value.");
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeSilenceBufferMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2200;
  return Math.max(250, Math.min(10_000, Math.round(parsed)));
}

function isTrustedSender(event, expectedWebContents, expectedUrl) {
  if (
    !event?.sender ||
    !expectedWebContents ||
    event.sender.id !== expectedWebContents.id ||
    event.sender.isDestroyed?.() ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    return false;
  }
  return event.senderFrame?.url === expectedUrl;
}

function isExpectedDocumentUrl(value, expectedUrl) {
  return typeof value === "string" && value === expectedUrl;
}

function isAllowedExternalUrl(value) {
  try {
    return new URL(value).href === LOCAL_WEB_UI_URL;
  } catch (error) {
    return false;
  }
}

function isAllowedMediaPermission(
  requestingWebContents,
  expectedWebContents,
  permission,
  details = {},
  expectedUrl,
) {
  if (
    !requestingWebContents ||
    !expectedWebContents ||
    requestingWebContents.id !== expectedWebContents.id ||
    requestingWebContents.isDestroyed?.() ||
    permission !== "media" ||
    (expectedUrl && requestingWebContents.mainFrame?.url !== expectedUrl)
  ) {
    return false;
  }
  const mediaTypes = Array.isArray(details.mediaTypes)
    ? details.mediaTypes
    : details.mediaType
      ? [details.mediaType]
      : [];
  return mediaTypes.length === 1 && mediaTypes[0] === "audio";
}

module.exports = {
  IPC_CHANNELS,
  LOCAL_WEB_UI_URL,
  isAllowedExternalUrl,
  isAllowedMediaPermission,
  isExpectedDocumentUrl,
  isTrustedSender,
  normalizeAvatarState,
  normalizeMouthRms,
  normalizeSilenceBufferMs,
};
