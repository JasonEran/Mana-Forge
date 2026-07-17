const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IPC_CHANNELS,
  LOCAL_WEB_UI_URL,
  isAllowedExternalUrl,
  isAllowedMediaPermission,
  isExpectedDocumentUrl,
  isTrustedSender,
  normalizeAvatarState,
  normalizeMouthRms,
  normalizeSilenceBufferMs,
} = require("../electron-security");

test("IPC channels are explicit and immutable", () => {
  assert.deepEqual(Object.keys(IPC_CHANNELS).sort(), [
    "AVATAR_BOOTSTRAP",
    "AVATAR_MOUTH",
    "AVATAR_MOUTH_CHANGED",
    "AVATAR_STATE",
    "AVATAR_STATE_CHANGED",
    "OPEN_LOCAL_WEB_UI",
    "RENDERER_CONFIG",
    "SCREEN_CAPTURE_PRIMARY",
    "VISION_HOTKEY",
  ]);
  assert.equal(Object.isFrozen(IPC_CHANNELS), true);
});

test("avatar state and mouth payloads are bounded", () => {
  assert.equal(normalizeAvatarState("excited"), "excited");
  assert.equal(normalizeAvatarState("sad"), "sad");
  assert.throws(() => normalizeAvatarState("../../shell"), /avatar state/);
  assert.equal(normalizeMouthRms(0.25), 0.25);
  assert.equal(normalizeMouthRms(3), 1);
  assert.equal(normalizeMouthRms(-2), 0);
  assert.throws(() => normalizeMouthRms("0.2"), /mouth RMS/);
});

test("renderer timing configuration is finite and bounded", () => {
  assert.equal(normalizeSilenceBufferMs(undefined), 2200);
  assert.equal(normalizeSilenceBufferMs("3000"), 3000);
  assert.equal(normalizeSilenceBufferMs("10"), 250);
  assert.equal(normalizeSilenceBufferMs("999999"), 10000);
  assert.equal(normalizeSilenceBufferMs("not-a-number"), 2200);
});

test("sender validation requires the expected top-level local window", () => {
  const trusted = { id: 42, isDestroyed: () => false };
  const mainFrame = { url: "file:///C:/Mana/renderer/index.html" };
  const validEvent = {
    sender: { id: 42, isDestroyed: () => false, mainFrame },
    senderFrame: mainFrame,
  };

  assert.equal(
    isTrustedSender(validEvent, trusted, mainFrame.url),
    true,
  );
  assert.equal(
    isTrustedSender(
      { ...validEvent, senderFrame: { url: mainFrame.url } },
      trusted,
      mainFrame.url,
    ),
    false,
  );
  assert.equal(
    isTrustedSender(validEvent, { ...trusted, id: 7 }, mainFrame.url),
    false,
  );
  assert.equal(
    isTrustedSender(validEvent, trusted, "file:///C:/Mana/avatar/index.html"),
    false,
  );
});

test("navigation and external-link policies use exact URLs", () => {
  const localDocument = "file:///C:/Mana/renderer/index.html";
  assert.equal(isExpectedDocumentUrl(localDocument, localDocument), true);
  assert.equal(
    isExpectedDocumentUrl("https://evil.example.test", localDocument),
    false,
  );
  assert.equal(LOCAL_WEB_UI_URL, "http://127.0.0.1:7860/");
  assert.equal(isAllowedExternalUrl("http://127.0.0.1:7860"), true);
  assert.equal(isAllowedExternalUrl("http://127.0.0.1:7860/evil"), false);
  assert.equal(isAllowedExternalUrl("https://example.test"), false);
});

test("only the trusted main window may request audio-only media", () => {
  const trustedUrl = "file:///C:/Mana/renderer/index.html";
  const trusted = { id: 42, isDestroyed: () => false };
  const requesting = {
    id: 42,
    isDestroyed: () => false,
    mainFrame: { url: trustedUrl },
  };

  assert.equal(
    isAllowedMediaPermission(requesting, trusted, "media", {
      mediaTypes: ["audio"],
    }, trustedUrl),
    true,
  );
  assert.equal(
    isAllowedMediaPermission(requesting, trusted, "media", {
      mediaTypes: ["audio", "video"],
    }, trustedUrl),
    false,
  );
  assert.equal(
    isAllowedMediaPermission(requesting, trusted, "geolocation", {}, trustedUrl),
    false,
  );
  assert.equal(
    isAllowedMediaPermission({ ...requesting, id: 7 }, trusted, "media", {
      mediaType: "audio",
    }, trustedUrl),
    false,
  );
  assert.equal(
    isAllowedMediaPermission(
      requesting,
      trusted,
      "media",
      { mediaTypes: ["audio"] },
      "file:///C:/Mana/avatar/index.html",
    ),
    false,
  );
});
