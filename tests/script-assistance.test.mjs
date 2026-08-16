import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSupportingScript,
  applyTranscriptCorrections,
  detectScriptRetakeHints,
  findScriptAssistedCorrections,
} from "../app/lib/transcription/script-assistance.mjs";

const timed = (tokens) => tokens.map((word, index) => ({
  word,
  start: index * 0.42,
  end: index * 0.42 + 0.3,
  confidence: word === "Kontent" ? 0.34 : 0.94,
}));

test("script context corrects a similar low-confidence word without changing timestamps", () => {
  const words = timed(["Our", "Kontent", "operating", "system", "works."]);
  const corrections = findScriptAssistedCorrections(words, "Our Content operating system works.");
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].word_index, 1);
  assert.equal(corrections[0].corrected_text, "Content");

  const corrected = applyTranscriptCorrections(words, corrections);
  assert.equal(corrected[1].word, "Content");
  assert.equal(corrected[1].start, words[1].start);
  assert.equal(corrected[1].end, words[1].end);
});

test("script assistance does not force a different spoken idea", () => {
  const words = timed(["Our", "customer", "revenue", "story", "works."]);
  const corrections = findScriptAssistedCorrections(words, "Our product retention story works.");
  assert.deepEqual(corrections, []);
});

test("a high-confidence grammatical variation is preserved with only one matching neighbor", () => {
  const words = [
    { word: "the", start: 0, end: 0.2, confidence: 0.95 },
    { word: "videos", start: 0.25, end: 0.55, confidence: 0.96 },
    { word: "you've", start: 0.6, end: 0.85, confidence: 0.94 },
  ];
  assert.deepEqual(findScriptAssistedCorrections(words, "the video you want"), []);
});

test("a low-confidence acronym can use one exact neighbor for correction", () => {
  const words = [
    { word: "light.", start: 0, end: 0.2, confidence: 0.95 },
    { word: "DJM", start: 0.25, end: 0.55, confidence: 0.31 },
    { word: "like", start: 0.6, end: 0.85, confidence: 0.42 },
  ];
  const [correction] = findScriptAssistedCorrections(words, "light. DJI Mic.");
  assert.equal(correction.corrected_text, "DJI");
});

test("detects two complete takes of the same supplied line and keeps the final take", () => {
  const words = timed([
    "Start", "with", "a", "clear", "story.", "Sorry,",
    "Start", "with", "a", "clear", "story.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "Start with a clear story.");
  assert.deepEqual(hint.earlierWordRange, [0, 5]);
  assert.deepEqual(hint.keptWordRange, [6, 10]);
  assert.deepEqual(hint.uniqueTerms, []);
  assert.match(hint.reason, /supplied script line/i);
});

test("script-guided retakes retain unique information as risk evidence", () => {
  const words = timed([
    "Start", "with", "a", "clear", "story.", "Customer", "revenue.",
    "Start", "with", "a", "clear", "story.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "Start with a clear story.");
  assert.ok(hint.uniqueTerms.includes("customer"));
  assert.ok(hint.uniqueTerms.includes("revenue"));
});

test("detects an incomplete script-aligned attempt before the final complete take", () => {
  const words = timed([
    "We", "help", "creators", "uh", "sorry,",
    "We", "help", "creators", "publish", "faster.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "We help creators publish faster.");
  assert.deepEqual(hint.earlierWordRange, [0, 4]);
  assert.deepEqual(hint.keptWordRange, [5, 9]);
  assert.deepEqual(hint.uniqueTerms, []);
  assert.match(hint.reason, /final detected take/i);
});

test("detects complete takes when one contains an inserted spoken filler", () => {
  const words = timed([
    "Start", "with", "a", "really", "clear", "story.", "No,",
    "Start", "with", "a", "clear", "story.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "Start with a clear story.");
  assert.deepEqual(hint.earlierWordRange, [0, 6]);
  assert.deepEqual(hint.keptWordRange, [7, 11]);
});

test("detects a changed earlier wording but protects its unique terms", () => {
  const words = timed([
    "We", "help", "creators", "post", "better", "content.", "Again,",
    "We", "help", "creators", "publish", "faster.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "We help creators publish faster.");
  assert.deepEqual(hint.earlierWordRange, [0, 6]);
  assert.deepEqual(hint.keptWordRange, [7, 11]);
  assert.ok(hint.uniqueTerms.includes("post"));
  assert.ok(hint.uniqueTerms.includes("better"));
  assert.ok(hint.uniqueTerms.includes("content"));
});

test("keeps the final take while retaining dropped script words as risk evidence", () => {
  const words = timed([
    "Comment", "BIBLE", "and", "I'll", "send", "you", "the", "link.",
    "Comment", "and", "I'll", "send", "you", "the", "link.",
  ]);
  const [hint] = detectScriptRetakeHints(words, "Comment BIBLE and I'll send you the link.");

  assert.deepEqual(hint.removedWordRange, [0, 7]);
  assert.deepEqual(hint.keptWordRange, [8, 14]);
  assert.ok(hint.uniqueTerms.includes("bible"));
  assert.match(hint.reason, /final (complete|detected) take/i);
});

test("finds repeated takes when the transcript mishears the line ending", () => {
  const words = timed([
    "Show", "up", "for", "the", "people", "everyone", "else's", "north.", "Bro,", "what?",
    "Show", "up", "for", "the", "people", "everyone", "else's", "north.",
    "Show", "for", "the", "people", "everyone", "else's", "north.",
  ]);
  const hints = detectScriptRetakeHints(words, "Show up for the people everyone else ignores.");

  assert.equal(hints.length, 1);
  assert.deepEqual(hints[0].removedWordRange, [0, 17]);
  assert.deepEqual(hints[0].keptWordRange, [18, 24]);
  assert.match(hints[0].reason, /final detected take/i);
});

test("a distinctive two-word script opening can identify an incomplete restart", () => {
  const words = timed([
    "And", "finally,", "I", "want", "to", "do", "that.", "You're", "actually", "as", "close", "to", "the", "new", "words.",
    "And", "finally,", "your", "actions", "be", "closer", "than", "your", "words.",
  ]);
  const [hint] = detectScriptRetakeHints(
    words,
    "And finally, let your actions speak louder than your words.",
  );

  assert.deepEqual(hint.removedWordRange, [0, 14]);
  assert.deepEqual(hint.keptWordRange, [15, 23]);
  assert.match(hint.reason, /final detected take/i);
});

test("does not create a retake from a single complete script occurrence", () => {
  const words = timed(["Today", "we", "help", "creators", "publish", "faster."]);
  assert.deepEqual(detectScriptRetakeHints(words, "We help creators publish faster."), []);
});

test("empty supporting scripts preserve the existing video-only analysis", () => {
  const words = timed(["Keep", "the", "current", "workflow."]);
  assert.deepEqual(analyzeSupportingScript(words, ""), {
    corrections: [],
    correctedWords: words,
    semanticHints: [],
    scriptWordCount: 0,
    matchedWordCount: 0,
  });
});
