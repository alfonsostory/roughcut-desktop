import assert from "node:assert/strict";
import test from "node:test";
import { getRemovedWordIndexes, reconstructParagraphTranscript } from "../app/lib/editing/transcript-view.mjs";

const words = [
  { word: "Start", start: 0.1, end: 0.4 },
  { word: "that", start: 0.5, end: 0.8 },
  { word: "again", start: 1.2, end: 1.6 },
  { word: "today.", start: 1.7, end: 2.1 },
];

const validation = { valid: true, issues: [], resultingGap: 0.18 };

test("paragraph transcript marks words removed by active timestamp-safe cuts", () => {
  const candidates = [{
    id: "retake",
    start: 0,
    end: 1.1,
    status: "approved",
    validation,
    sourceWordRange: [0, 1],
  }];

  assert.deepEqual([...getRemovedWordIndexes(words, candidates)], [0, 1]);
  assert.equal(reconstructParagraphTranscript(words, candidates), "again today.");
});

test("paragraph transcript preserves kept and safety-blocked words", () => {
  const candidates = [
    { id: "kept", start: 0, end: 0.9, status: "rejected", validation, sourceWordRange: [0, 1] },
    { id: "blocked", start: 1.1, end: 2.2, status: "approved", validation: { ...validation, valid: false }, sourceWordRange: [2, 3] },
  ];

  assert.equal(getRemovedWordIndexes(words, candidates).size, 0);
  assert.equal(reconstructParagraphTranscript(words, candidates), "Start that again today.");
});
