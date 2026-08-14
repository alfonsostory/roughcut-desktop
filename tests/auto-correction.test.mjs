import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("local correction prefers vocabulary confirmed elsewhere in the transcript", (t) => {
  const script = fileURLToPath(new URL("../transcription/spellcheck.swift", import.meta.url));
  const result = spawnSync("swift", [script], {
    encoding: "utf8",
    input: JSON.stringify([
      { word: "concentration", confidence: 0.98 },
      { word: "concentratoin", confidence: 0.25 },
      { word: "purcheses", confidence: 0.31 },
      { word: "purchases", confidence: 0.96 },
      { word: "purchases", confidence: 0.94 },
    ]),
  });
  if (result.error?.code === "ENOENT") {
    t.skip("Swift is unavailable on this platform");
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  const corrections = JSON.parse(result.stdout);
  assert.deepEqual(corrections.map(({ word_index, corrected_text, status }) => ({ word_index, corrected_text, status })), [
    { word_index: 1, corrected_text: "concentration", status: "applied" },
    { word_index: 2, corrected_text: "purchases", status: "applied" },
  ]);
});
