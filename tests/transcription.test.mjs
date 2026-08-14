import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { normalizeTranscriptPayload } from "../app/lib/transcription/normalize.mjs";
import { createTranscriptionServer } from "../transcription/server.mjs";

test("normalizes a valid word-timestamp transcript", () => {
  const result = normalizeTranscriptPayload({
    duration: 2,
    words: [
      { word: " hello ", start: 0.1234, end: 0.5678, confidence: 1.2 },
      { word: "world", start: 0.7, end: 1.1 },
    ],
  });
  assert.deepEqual(result.words, [
    { word: "hello", start: 0.123, end: 0.568, confidence: 1 },
    { word: "world", start: 0.7, end: 1.1 },
  ]);
  assert.equal(result.duration, 2);
  assert.deepEqual(result.semantic_hints, []);
});

test("normalizes breath evidence for the pause-cut engine", () => {
  const result = normalizeTranscriptPayload({
    duration: 1.2,
    words: [
      { word: "hello", start: 0.1, end: 0.4 },
      { word: "again", start: 0.8, end: 1.1 },
    ],
    audio_analysis: {
      frame_duration: 0.01,
      silence_threshold_db: -40,
      minimum_silence: 0.2,
      silences: [],
      breaths: [{ start: 0.46, end: 0.7, confidence: 1.2, mean_db: -31 }],
    },
  });

  assert.deepEqual(result.audio_analysis.breaths, [{
    start: 0.46,
    end: 0.7,
    duration: 0.24,
    confidence: 1,
    mean_db: -31,
    evidence: undefined,
  }]);
});

test("rejects invalid and out-of-order timestamps", () => {
  assert.throws(() => normalizeTranscriptPayload({ words: [{ word: "bad", start: 1, end: 0.5 }] }), /invalid time range/);
  assert.throws(() => normalizeTranscriptPayload({ words: [
    { word: "later", start: 2, end: 2.2 },
    { word: "earlier", start: 1, end: 1.2 },
  ] }), /chronological order/);
});

test("the local transcription endpoint accepts video bytes and returns timed words", async (t) => {
  const server = createTranscriptionServer({
    transcribe: async (inputPath) => ({
      duration: 1.4,
      words: [{ word: "tested", start: 0.2, end: 0.6, confidence: 0.98 }],
      semantic_hints: [],
      sourcePathWasTemporary: inputPath.includes("roughcut-transcribe-"),
    }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/transcribe`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "video/mp4",
      "x-file-name": encodeURIComponent("sample video.mp4"),
    },
    body: Buffer.from("fake-video"),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const payload = await response.json();
  assert.equal(payload.words[0].word, "tested");
  assert.equal(payload.sourcePathWasTemporary, true);
});
