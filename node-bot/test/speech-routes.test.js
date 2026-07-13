const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const multer = require("multer");
const test = require("node:test");

const { registerSpeechRoutes } = require("../speech-routes");

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

function createSpeechApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  const upload = multer({ storage: multer.memoryStorage() });
  registerSpeechRoutes(app, upload, {
    TTS_PROVIDER: "kokoro",
    buildAssistantReply: async () => "assistant reply",
    buildMarketContextForPrompt: async () => "",
    cleanupUploadedAudio: () => {},
    fs: {
      existsSync: () => true,
      statSync: () => ({ size: 4 }),
    },
    marketDataClient: {},
    normalizeUploadedAudio: () => ({
      tmpPath: "upload.tmp",
      audioPath: "normalized.wav",
    }),
    runWhisper: () => "voice message",
    synthesizeReply: async () => Buffer.from("fake-wav"),
    ...overrides,
  });
  return app;
}

function audioForm(fields = {}) {
  const form = new FormData();
  form.append("file", new Blob(["RIFF"], { type: "audio/wav" }), "voice.wav");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

test("transcribe-only returns Whisper text and cleans the upload", async () => {
  const calls = [];
  const app = createSpeechApp({
    normalizeUploadedAudio: (file) => {
      assert.equal(file.originalname, "voice.wav");
      return { tmpPath: "upload.tmp", audioPath: "normalized.wav" };
    },
    runWhisper: (audioPath) => {
      calls.push(["whisper", audioPath]);
      return "hello Mana";
    },
    cleanupUploadedAudio: (...paths) => calls.push(["cleanup", ...paths]),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/transcribe-only`, {
      method: "POST",
      body: audioForm(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { transcript: "hello Mana" });
  });

  assert.deepEqual(calls, [
    ["whisper", "normalized.wav"],
    ["cleanup", "upload.tmp", "normalized.wav"],
  ]);
});

test("transcribe preserves reply arguments and response schema", async () => {
  const calls = [];
  const app = createSpeechApp({
    buildMarketContextForPrompt: async (transcript, marketClient) => {
      calls.push(["market", transcript, marketClient.id]);
      return "market context";
    },
    marketDataClient: { id: "market-client" },
    buildAssistantReply: async (...args) => {
      calls.push(["reply", ...args]);
      return "spoken reply";
    },
    cleanupUploadedAudio: (...paths) => calls.push(["cleanup", ...paths]),
  });

  const originalLog = console.log;
  console.log = () => {};
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/transcribe`, {
        method: "POST",
        body: audioForm({ sessionId: "session-1", assistantMode: "coding" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        transcript: "voice message",
        reply: "spoken reply",
        ttsConfigured: true,
      });
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, [
    ["market", "voice message", "market-client"],
    [
      "reply",
      "voice message",
      "",
      "market context",
      "default",
      "session-1",
      "coding",
    ],
    ["cleanup", "upload.tmp", "normalized.wav"],
  ]);
});

test("synthesize returns WAV bytes from the injected TTS runtime", async () => {
  const app = createSpeechApp({
    synthesizeReply: async (text) => {
      assert.equal(text, "Hello there");
      return Buffer.from("wav-bytes");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: " Hello there " }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^audio\/wav/);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "wav-bytes");
  });
});

test("speech routes preserve missing-input and disabled-TTS errors", async () => {
  const app = createSpeechApp({ TTS_PROVIDER: "none" });

  await withServer(app, async (baseUrl) => {
    const missingFile = await fetch(`${baseUrl}/transcribe-only`, {
      method: "POST",
    });
    assert.equal(missingFile.status, 400);
    assert.deepEqual(await missingFile.json(), { error: "file is required" });

    const disabledTts = await fetch(`${baseUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(disabledTts.status, 400);
    assert.deepEqual(await disabledTts.json(), { error: "TTS not configured" });
  });
});
