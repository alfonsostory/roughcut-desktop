import assert from "node:assert/strict";
import test from "node:test";
import { detectRetakeHints, mergeSemanticHints } from "../app/lib/editing/retakes.mjs";

const timed = (tokens) => tokens.map((word, index) => ({
  word,
  start: index * 0.4,
  end: index * 0.4 + 0.28,
}));

test("detects an incomplete repeated opening and prefers the final complete take", () => {
  const words = timed([
    "Before.",
    "Third,", "this", "three", "hour", "podcast", "with", "Bart.",
    "Third,", "this", "three", "hour", "podcast", "with", "Bryan", "Cochran,", "one", "of", "the", "best.",
  ]);
  const [hint] = detectRetakeHints(words);
  assert.deepEqual(hint.earlierWordRange, [1, 7]);
  assert.deepEqual(hint.keptWordRange, [8, 19]);
  assert.deepEqual(hint.uniqueTerms, []);
  assert.ok(hint.confidence >= 0.94);
});

test("preserves longer unmatched information as visible risk evidence", () => {
  const words = timed([
    "We", "should", "start", "the", "story", "with", "customer", "revenue", "details.",
    "We", "should", "start", "the", "story", "with", "a", "short", "hook", "today.",
  ]);
  const [hint] = detectRetakeHints(words);
  assert.ok(hint.uniqueTerms.includes("customer"));
  assert.ok(hint.uniqueTerms.includes("revenue"));
});

test("merges detected hints without duplicating imported semantic decisions", () => {
  const hint = {
    kind: "retake",
    earlierWordRange: [0, 4],
    keptWordRange: [5, 10],
    confidence: 0.95,
    reason: "Repeated take.",
  };
  assert.equal(mergeSemanticHints([hint], [{ ...hint }]).length, 1);
});
