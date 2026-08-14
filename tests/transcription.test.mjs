import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { findFirstRecognizableWord, normalizeTranscriptPayload } from "../app/lib/transcription/normalize.mjs";
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

test("opening-word recognition skips noise labels and low-confidence noise tokens", () => {
  const words = [
    { word: "[Noise]", start: 0.02, end: 0.18, confidence: 0.99 },
    { word: "uh", start: 0.25, end: 0.34, confidence: 0.18 },
    { word: "Welcome", start: 0.82, end: 1.16, confidence: 0.94 },
  ];

  const result = findFirstRecognizableWord(words);
  assert.equal(result.index, 2);
  assert.equal(result.word.word, "Welcome");
  assert.equal(result.ignoredLeadingTokens, 2);
  assert.equal(result.usedLowConfidenceFallback, false);
});

test("opening-word recognition keeps a low-confidence word that begins a confident speech run", () => {
  const result = findFirstRecognizableWord([
    { word: "10", start: 0, end: 1.02, confidence: 0.2725 },
    { word: ".10.", start: 1.02, end: 1.34, confidence: 0.1975 },
    { word: "Contecration", start: 1.54, end: 2.06, confidence: 0.2861 },
    { word: "purchases", start: 2.06, end: 2.48, confidence: 0.6597 },
    { word: "that", start: 2.48, end: 2.76, confidence: 0.8203 },
    { word: "get", start: 2.76, end: 2.9, confidence: 0.9536 },
  ]);

  assert.equal(result.index, 2);
  assert.equal(result.word.word, "Contecration");
  assert.equal(result.usedLowConfidenceFallback, false);
});

test("opening-word recognition falls back conservatively when every word is uncertain", () => {
  const words = [
    { word: "Maybe", start: 0.2, end: 0.5, confidence: 0.31 },
    { word: "speech", start: 0.6, end: 0.9, confidence: 0.42 },
  ];

  const result = findFirstRecognizableWord(words);
  assert.equal(result.index, 0);
  assert.equal(result.usedLowConfidenceFallback, true);
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
