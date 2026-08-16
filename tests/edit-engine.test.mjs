import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  buildEdl,
  generateCandidateCuts,
  validateCut,
  validateEditedResult,
} from "../app/lib/editing/engine.mjs";

const words = [
  { word: "one", start: 0.2, end: 0.5 },
  { word: "two", start: 1.5, end: 1.8 },
  { word: "start", start: 2.1, end: 2.4 },
  { word: "again", start: 3.4, end: 3.8 },
];

test("long pauses are shortened to the configured target with speech-safe sides", () => {
  const [cut] = generateCandidateCuts(words.slice(0, 2));
  assert.equal(cut.type, "silence");
  assert.equal(cut.start, 0.59);
  assert.equal(cut.end, 1.41);
  assert.equal(cut.validation.resultingGap, 0.18);
  assert.equal(cut.validation.valid, true);
});

test("pauses at or below the calibrated 200 ms maximum are left alone", () => {
  const closeWords = [{ word: "a", start: 0, end: 0.4 }, { word: "b", start: 0.6, end: 1.0 }];
  assert.equal(generateCandidateCuts(closeWords).length, 0);
});

test("breathing inside a safe word gap is treated as a pause", () => {
  const breathWords = [
    { word: "take", start: 0, end: 0.4 },
    { word: "two", start: 0.595, end: 0.9 },
  ];
  const cuts = generateCandidateCuts(breathWords, [], DEFAULT_CONFIG, {
    duration: 0.9,
    audioSilences: [],
    audioBreaths: [{
      start: 0.43,
      end: 0.56,
      duration: 0.13,
      confidence: 0.91,
      evidence: "broadband_nonverbal_audio_between_words",
    }],
  });
  const breathCut = cuts.find((cut) => cut.breathDetected);

  assert.ok(breathCut);
  assert.equal(breathCut.start, 0.49);
  assert.equal(breathCut.end, 0.505);
  assert.equal(breathCut.validation.resultingGap, 0.18);
  assert.equal(breathCut.status, "approved");
  assert.match(breathCut.reason, /Breath-like broadband audio/);
});

test("breath evidence overlapping a timed word is never cut", () => {
  const breathWords = [
    { word: "take", start: 0.1, end: 0.4 },
    { word: "two", start: 0.7, end: 0.9 },
  ];
  const cuts = generateCandidateCuts(breathWords, [], DEFAULT_CONFIG, {
    duration: 0.9,
    audioSilences: [],
    audioBreaths: [{ start: 0.35, end: 0.52, duration: 0.17, confidence: 0.9 }],
  });

  assert.equal(cuts.some((cut) => cut.breathDetected), false);
});

test("opening silence is trimmed even when it is below the internal-pause threshold", () => {
  const openingWords = [{ word: "hello", start: 0.16, end: 0.42 }];
  const [cut] = generateCandidateCuts(openingWords, [], DEFAULT_CONFIG, {
    duration: 0.5,
    audioSilences: [],
  });

  assert.equal(cut.start, 0);
  assert.equal(cut.end, 0.07);
  assert.equal(cut.type, "silence");
  assert.equal(cut.status, "approved");
  assert.equal(cut.validation.valid, true);
  assert.match(cut.reason, /Trim opening silence to 0\.09s/);
  assert.match(cut.resulting_text, /0\.09s safe pre-roll/);
});

test("opening trim removes noise tokens before the first recognizable word", () => {
  const openingWords = [
    { word: "[Noise]", start: 0.02, end: 0.18, confidence: 0.99 },
    { word: "uh", start: 0.25, end: 0.34, confidence: 0.18 },
    { word: "Welcome", start: 0.82, end: 1.16, confidence: 0.94 },
  ];
  const cuts = generateCandidateCuts(openingWords, [], DEFAULT_CONFIG, {
    duration: 1.16,
    audioSilences: [],
    openingWordIndex: 2,
    openingWordConfidence: 0.94,
  });
  const openingCut = cuts.find((cut) => cut.openingTrim);

  assert.ok(openingCut);
  assert.equal(openingCut.start, 0);
  assert.equal(openingCut.end, 0.73);
  assert.equal(openingCut.status, "approved");
  assert.match(openingCut.reason, /selected “Welcome”/);
  assert.match(openingCut.original_text, /\[Noise\] uh/);
  assert.equal(validateEditedResult(openingWords, cuts).reconstructedTranscript, "Welcome");
});

test("measured audio activity preserves low-confidence opening speech", () => {
  const openingWords = [
    { word: "10", start: 0, end: 1.02, confidence: 0.2725 },
    { word: ".10.", start: 1.02, end: 1.34, confidence: 0.1975 },
    { word: "Contecration", start: 1.54, end: 2.06, confidence: 0.2861 },
    { word: "purchases", start: 2.06, end: 2.48, confidence: 0.6597 },
    { word: "that", start: 2.48, end: 2.76, confidence: 0.8203 },
    { word: "get", start: 2.76, end: 2.9, confidence: 0.9536 },
  ];
  const cuts = generateCandidateCuts(openingWords, [], DEFAULT_CONFIG, {
    duration: 3,
    audioSilences: [{ start: 0, end: 0.79, duration: 0.79, minimum_db: -120 }],
    openingWordIndex: 0,
    openingWordConfidence: 0.2725,
  });
  const openingCut = cuts.find((cut) => cut.openingTrim);

  assert.ok(openingCut);
  assert.equal(openingCut.start, 0);
  assert.equal(openingCut.end, 0.7);
  assert.equal(openingCut.validation.valid, true);
  assert.equal(openingCut.status, "approved");
  assert.ok(buildEdl(3, cuts).some((range) => range.action === "remove" && range.start === 0 && range.end === 0.7));
  assert.match(validateEditedResult(openingWords, cuts).reconstructedTranscript, /^10 \.10\. Contecration purchases/);
});

test("opening trim never removes the configured word-safety pre-roll", () => {
  const openingWords = [{ word: "hello", start: 0.08, end: 0.32 }];
  const cuts = generateCandidateCuts(openingWords, [], DEFAULT_CONFIG, {
    duration: 0.4,
    audioSilences: [],
  });

  assert.equal(cuts.some((cut) => cut.start === 0), false);
});

test("audio-energy analysis adds head, tail, and timestamp-independent silence cuts", () => {
  const energyWords = [
    { word: "hello", start: 1.2, end: 1.5 },
    { word: "world", start: 2.0, end: 2.3 },
  ];
  const cuts = generateCandidateCuts(energyWords, [], DEFAULT_CONFIG, {
    duration: 3.2,
    silenceThresholdDb: -40,
    audioSilences: [
      { start: 0, end: 1.05, duration: 1.05, minimum_db: -60 },
      { start: 1.55, end: 1.91, duration: 0.36, minimum_db: -52 },
      { start: 2.45, end: 3.18, duration: 0.73, minimum_db: -58 },
    ],
  });
  assert.ok(cuts.some((cut) => cut.start === 0 && cut.end === 0.96));
  assert.ok(cuts.some((cut) => cut.audioVerified && cut.start <= 1.64 && cut.end >= 1.91));
  assert.ok(cuts.some((cut) => cut.start === 2.39 && cut.end === 3.2));
  assert.ok(cuts.every((cut) => cut.validation.valid));
});

test("semantic retake selection is mapped to exact word boundaries", () => {
  const cuts = generateCandidateCuts(words, [{
    kind: "retake",
    earlierWordRange: [2, 2],
    keptWordRange: [3, 3],
    confidence: 0.95,
    reason: "Incomplete take followed by a complete take.",
  }]);
  const retake = cuts.find((cut) => cut.type === "retake");
  assert.equal(retake.start, 1.9);
  assert.equal(retake.end, 3.3);
  assert.equal(retake.validation.valid, true);
  assert.equal(retake.status, "approved");
});

test("semantic retakes use measured audio onset when the first kept word timestamp is late", () => {
  const onsetWords = [
    { word: "Before.", start: 0, end: 0.4 },
    { word: "Wrong", start: 1, end: 1.4 },
    { word: "take.", start: 1.5, end: 1.9 },
    { word: "Correct", start: 2.5, end: 2.9 },
    { word: "sentence.", start: 3, end: 3.5 },
  ];
  const cuts = generateCandidateCuts(onsetWords, [{
    kind: "retake",
    earlierWordRange: [1, 2],
    keptWordRange: [3, 4],
    confidence: 0.95,
    reason: "Earlier take restarts.",
  }], DEFAULT_CONFIG, {
    duration: 3.8,
    audioSilences: [{ start: 1.9, end: 2.24, duration: 0.34, minimum_db: -62 }],
  });

  const retake = cuts.find((cut) => cut.type === "retake");
  assert.equal(retake.start, 0.5);
  assert.equal(retake.end, 2.14);
  assert.equal(retake.audioVerified, true);
  assert.equal(retake.validation.valid, true);
  assert.match(retake.reason, /260 ms before its word timestamp/);
});

test("unique information stays high risk but is active by default", () => {
  const cuts = generateCandidateCuts(words, [{
    kind: "retake",
    earlierWordRange: [2, 2],
    keptWordRange: [3, 3],
    confidence: 0.91,
    reason: "Similar takes.",
    uniqueTerms: ["start"],
  }]);
  const risky = cuts.find((cut) => cut.type === "retake");
  assert.equal(risky.risk, "high");
  assert.equal(risky.status, "approved");
  assert.ok(buildEdl(4, cuts).some((range) => range.candidateCutIds?.includes(risky.id)));
});

test("cut validation rejects a boundary inside a spoken word", () => {
  const result = validateCut({ start: 0.3, end: 1.3 }, words, DEFAULT_CONFIG);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("intersects")));
});

test("unsafe generated boundaries are approved by default but blocked from the EDL", () => {
  const overlappingWords = [
    { word: "first", start: 0, end: 0.5 },
    { word: "second", start: 0.45, end: 0.8 },
  ];
  const cuts = generateCandidateCuts(overlappingWords, [{
    kind: "retake",
    earlierWordRange: [0, 0],
    keptWordRange: [1, 1],
    confidence: 0.95,
    reason: "Overlapping timestamp fixture.",
  }]);
  const unsafe = cuts.find((cut) => cut.type === "retake");

  assert.equal(unsafe.validation.valid, false);
  assert.equal(unsafe.status, "approved");
  assert.ok(buildEdl(0.8, cuts).every((range) => !range.candidateCutIds?.includes(unsafe.id)));
});

test("overlapping approved silence and retake cuts are merged instead of dropping the retake", () => {
  const cuts = generateCandidateCuts(words, [{
    kind: "retake",
    earlierWordRange: [2, 2],
    keptWordRange: [3, 3],
    confidence: 0.95,
    reason: "Restart.",
  }]);
  const removal = buildEdl(4, cuts).find((range) => range.action === "remove" && range.start === 1.89);
  assert.ok(removal);
  assert.ok(removal.candidateCutIds.length >= 2);
  assert.equal(removal.end, 3.31);
});

test("result validation reconstructs transcript and reports no missing meaning for a repeated take", () => {
  const repeatedWords = [
    { word: "we", start: 0.1, end: 0.3 },
    { word: "begin", start: 0.35, end: 0.7 },
    { word: "we", start: 1.8, end: 2.0 },
    { word: "begin", start: 2.05, end: 2.4 },
    { word: "today", start: 2.45, end: 2.8 },
  ];
  const cuts = generateCandidateCuts(repeatedWords, [{
    kind: "repetition",
    earlierWordRange: [0, 1],
    keptWordRange: [2, 4],
    confidence: 0.96,
    reason: "Final complete take wins.",
  }]);
  const result = validateEditedResult(repeatedWords, cuts);
  assert.equal(result.valid, true);
  assert.equal(result.reconstructedTranscript, "we begin today");
  assert.deepEqual(result.missingUniqueWords, []);
});

test("result validation respects semantic correction classification and overlapping silence ranges", () => {
  const correctionWords = [
    { word: "intro", start: 0, end: 0.3 },
    { word: "with", start: 0.4, end: 0.6 },
    { word: "Bart.", start: 0.6, end: 0.9 },
    { word: "with", start: 1.8, end: 2.0 },
    { word: "Bryan", start: 2.0, end: 2.3 },
    { word: "Cochran.", start: 2.3, end: 2.7 },
  ];
  const cuts = generateCandidateCuts(correctionWords, [{
    kind: "retake",
    earlierWordRange: [1, 2],
    keptWordRange: [3, 5],
    confidence: 0.96,
    reason: "Corrected name in the complete take.",
    uniqueTerms: [],
  }], DEFAULT_CONFIG, {
    duration: 3,
    audioSilences: [{ start: 0.9, end: 1.8, duration: 0.9, minimum_db: -55 }],
    silenceThresholdDb: -40,
  });
  const result = validateEditedResult(correctionWords, cuts);
  assert.deepEqual(result.missingUniqueWords, []);
  assert.deepEqual(result.remainingLongPauses, []);
  assert.equal(result.valid, true);
});
