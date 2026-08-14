import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = path.join(root, "work", "whisper-env", "bin", "python");

test("broadband breathing is detected only between timestamped words", {
  skip: !existsSync(python) && "Local transcription environment is not installed",
}, () => {
  const script = `
import json
import sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(path.join(root, "transcription"))})
from breath_detection import detect_audio_breaths

rng = np.random.default_rng(7)
samples = np.zeros(24000, dtype=np.float32)
noise = rng.normal(0, 1, 5600).astype(np.float32)
noise = np.concatenate(([0], np.diff(noise)))
noise = noise / (np.max(np.abs(noise)) + 1e-9) * 0.08
samples[7200:12800] = noise
words = [
    {"word": "hello", "start": 0.1, "end": 0.35},
    {"word": "world", "start": 1.05, "end": 1.3},
]
print(json.dumps(detect_audio_breaths(samples, words)))
`;
  const breaths = JSON.parse(execFileSync(python, ["-c", script], {
    cwd: root,
    encoding: "utf8",
  }));

  assert.equal(breaths.length, 1);
  assert.ok(breaths[0].start >= 0.35);
  assert.ok(breaths[0].end <= 1.05);
  assert.ok(breaths[0].duration >= 0.12);
  assert.ok(breaths[0].confidence >= 0.8);
});
