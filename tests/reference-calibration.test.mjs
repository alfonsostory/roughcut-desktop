import assert from "node:assert/strict";
import test from "node:test";
import { calibrateFromReferenceEdit } from "../app/lib/calibration/reference.mjs";

test("reference calibration learns aggressive pacing without violating speech safety", () => {
  const source = {
    duration: 4,
    words: [
      { word: "keep", start: 0.1, end: 0.4 },
      { word: "moving", start: 1.2, end: 1.5 },
      { word: "right", start: 2.3, end: 2.6 },
      { word: "now", start: 3.4, end: 3.7 },
    ],
  };
  const edited = {
    duration: 1.6,
    words: [
      { word: "keep", start: 0.1, end: 0.4 },
      { word: "moving", start: 0.4, end: 0.7 },
      { word: "right", start: 0.7, end: 1 },
      { word: "now", start: 1, end: 1.3 },
    ],
  };
  const result = calibrateFromReferenceEdit(source, edited);
  assert.equal(result.config.longPauseThreshold, 0.8);
  assert.equal(result.config.targetPause, 0.18);
  assert.equal(result.config.speechSafetyPadding, 0.09);
  assert.equal(result.config.minimumTransition, 0.18);
  assert.equal(result.evidence.safetyConstrainedTarget, true);
  assert.equal(result.evidence.pauseSamples.length, 3);
});

test("reference calibration identifies substantial removed speech runs", () => {
  const result = calibrateFromReferenceEdit({
    duration: 3,
    words: [
      { word: "we", start: 0, end: 0.2 },
      { word: "can", start: 0.2, end: 0.4 },
      { word: "probably", start: 0.4, end: 0.7 },
      { word: "remove", start: 0.7, end: 1 },
      { word: "this", start: 1, end: 1.2 },
      { word: "today", start: 1.4, end: 1.8 },
    ],
  }, {
    duration: 1,
    words: [
      { word: "we", start: 0, end: 0.2 },
      { word: "today", start: 0.4, end: 0.8 },
    ],
  });
  assert.deepEqual(result.evidence.removedWordRuns[0].sourceWordRange, [1, 4]);
  assert.equal(result.evidence.removedWordRuns[0].text, "can probably remove this");
});
