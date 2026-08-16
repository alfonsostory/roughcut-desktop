import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeSilence,
  createWaveformPeaks,
  detectAudioBreaths,
  detectAudioSilences,
} from "../transcription/audio-analysis.mjs";
import { buildRenderFilter } from "../transcription/server.mjs";

test("portable audio analysis finds long silence and verifies the maximum gap", () => {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    if (time < 0.5 || time >= 1.25) samples[index] = Math.sin(2 * Math.PI * 220 * time) * 0.2;
  }
  const silences = detectAudioSilences(samples, sampleRate);
  assert.equal(silences.length, 1);
  assert.ok(Math.abs(silences[0].start - 0.5) <= 0.01);
  assert.ok(Math.abs(silences[0].end - 1.25) <= 0.01);
  const validation = analyzeSilence(samples, sampleRate);
  assert.equal(validation.maximum_measured_silence, 0.75);
  assert.equal(validation.long_silences.length, 1);
  assert.equal(createWaveformPeaks(samples, 12).length, 12);
});

test("portable breath detection remains constrained to timestamped word gaps", () => {
  const sampleRate = 16000;
  const samples = new Float32Array(24000);
  let state = 7;
  let previous = 0;
  for (let index = 7200; index < 12800; index += 1) {
    state = (state * 16807) % 2147483647;
    const noise = (state / 2147483647 * 2 - 1) * 0.05;
    samples[index] = noise - previous;
    previous = noise;
  }
  const breaths = detectAudioBreaths(samples, [
    { word: "hello", start: 0.1, end: 0.35 },
    { word: "world", start: 1.05, end: 1.3 },
  ], sampleRate);
  assert.equal(breaths.length, 1);
  assert.ok(breaths[0].start >= 0.35);
  assert.ok(breaths[0].end <= 1.05);
  assert.ok(breaths[0].duration >= 0.12);
});

test("portable renderer maps audio and offset video from the same EDL ranges", () => {
  const filter = buildRenderFilter([
    { start: 1.2, end: 2.4 },
    { start: 3.1, end: 4.8 },
  ], 0.176032);
  assert.match(filter, /trim=start=1\.376032:end=2\.576032/);
  assert.match(filter, /atrim=start=1\.200000:end=2\.400000/);
  assert.match(filter, /concat=n=2:v=1:a=1/);
});
