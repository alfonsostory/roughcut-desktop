import { readFile } from "node:fs/promises";

const percentile = (values, percentage) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * percentage));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

export function decodePcmWav(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a PCM WAV file.");
  }

  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = bytes.subarray(start, Math.min(bytes.length, start + size));
    }
    offset = start + size + (size % 2);
  }

  if (!format || !data || format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Expected 16-bit integer PCM WAV audio.");
  }

  const frameCount = Math.floor(data.length / 2 / format.channels);
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2) / 32768;
    }
    samples[frame] = sum / format.channels;
  }
  return { samples, sampleRate: format.sampleRate, duration: frameCount / format.sampleRate };
}

export async function readPcmWav(filePath) {
  return decodePcmWav(await readFile(filePath));
}

export function detectAudioSilences(
  samples,
  sampleRate = 16000,
  { frameDuration = 0.01, thresholdDb = -40, minimumDuration = 0.2 } = {},
) {
  const frameSize = Math.max(1, Math.round(sampleRate * frameDuration));
  const levels = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += frameSize) {
    let sumSquares = 0;
    for (let index = offset; index < offset + frameSize; index += 1) sumSquares += samples[index] ** 2;
    levels.push(20 * Math.log10(Math.sqrt(sumSquares / frameSize + 1e-12)));
  }

  const silences = [];
  let startFrame;
  for (let index = 0; index <= levels.length; index += 1) {
    const level = index < levels.length ? levels[index] : 0;
    if (level < thresholdDb && startFrame === undefined) startFrame = index;
    if (level >= thresholdDb && startFrame !== undefined) {
      const start = startFrame * frameDuration;
      const end = index * frameDuration;
      if (end - start > minimumDuration + 0.001) {
        let minimumDb = Number.POSITIVE_INFINITY;
        for (let frame = startFrame; frame < index; frame += 1) minimumDb = Math.min(minimumDb, levels[frame]);
        silences.push({
          start: Number(start.toFixed(3)),
          end: Number(end.toFixed(3)),
          duration: Number((end - start).toFixed(3)),
          minimum_db: Number(minimumDb.toFixed(2)),
        });
      }
      startFrame = undefined;
    }
  }
  return silences;
}

export function createWaveformPeaks(samples, targetPeaks = 360) {
  if (!samples.length) return [];
  const count = Math.min(targetPeaks, samples.length);
  const peaks = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * samples.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / count));
    const window = [];
    const sampleStep = Math.max(1, Math.floor((end - start) / 256));
    for (let sample = start; sample < end; sample += sampleStep) window.push(Math.abs(samples[sample]));
    peaks.push(percentile(window, 0.95));
  }
  const ceiling = Math.max(percentile(peaks, 0.98), 1e-6);
  return peaks.map((peak) => Number(Math.min(1, Math.sqrt(peak / ceiling)).toFixed(4)));
}

function spectrumFeatures(samples, offset, frameSize, sampleRate) {
  const fftSize = 2 ** Math.ceil(Math.log2(frameSize));
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  let sumSquares = 0;
  let crossings = 0;
  for (let index = 0; index < frameSize; index += 1) {
    const sample = samples[offset + index];
    sumSquares += sample ** 2;
    if (index > 0 && (sample < 0) !== (samples[offset + index - 1] < 0)) crossings += 1;
    real[index] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, frameSize - 1)));
  }

  for (let index = 1, target = 0; index < fftSize; index += 1) {
    let bit = fftSize >> 1;
    while (target & bit) { target ^= bit; bit >>= 1; }
    target ^= bit;
    if (index < target) [real[index], real[target]] = [real[target], real[index]];
  }
  for (let length = 2; length <= fftSize; length *= 2) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < fftSize; start += length) {
      for (let index = 0; index < length / 2; index += 1) {
        const cosine = Math.cos(angle * index);
        const sine = Math.sin(angle * index);
        const even = start + index;
        const odd = even + length / 2;
        const oddReal = real[odd] * cosine - imaginary[odd] * sine;
        const oddImaginary = real[odd] * sine + imaginary[odd] * cosine;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }

  let audiblePower = 1e-12;
  let highPower = 0;
  let logPower = 0;
  let powerTotal = 0;
  let audibleBins = 0;
  for (let bin = 0; bin <= fftSize / 2; bin += 1) {
    const frequency = bin * sampleRate / fftSize;
    if (frequency < 120 || frequency > 7000) continue;
    const power = real[bin] ** 2 + imaginary[bin] ** 2 + 1e-12;
    audiblePower += power;
    if (frequency >= 900) highPower += power;
    logPower += Math.log(power);
    powerTotal += power;
    audibleBins += 1;
  }
  const rms = Math.sqrt(sumSquares / frameSize + 1e-12);
  return {
    levelDb: 20 * Math.log10(rms),
    zeroCrossingRate: crossings / Math.max(1, frameSize - 1),
    highRatio: highPower / audiblePower,
    flatness: audibleBins ? Math.exp(logPower / audibleBins) / (powerTotal / audibleBins) : 0,
  };
}

export function detectAudioBreaths(
  samples,
  words,
  sampleRate = 16000,
  { frameDuration = 0.03, hopDuration = 0.01, minimumDuration = 0.12, minimumGap = 0.18 } = {},
) {
  const frameSize = Math.round(sampleRate * frameDuration);
  const hopSize = Math.round(sampleRate * hopDuration);
  const breaths = [];
  for (let wordIndex = 0; wordIndex + 1 < words.length; wordIndex += 1) {
    const gapStart = Number(words[wordIndex].end);
    const gapEnd = Number(words[wordIndex + 1].start);
    if (gapEnd - gapStart <= minimumGap + 0.001) continue;
    const firstOffset = Math.max(0, Math.round(gapStart * sampleRate));
    const lastOffset = Math.min(samples.length, Math.round(gapEnd * sampleRate));
    const frames = [];
    for (let offset = firstOffset; offset + frameSize <= lastOffset; offset += hopSize) {
      const features = spectrumFeatures(samples, offset, frameSize, sampleRate);
      if (
        features.levelDb >= -42 && features.levelDb <= -14
        && features.zeroCrossingRate >= 0.045
        && features.highRatio >= 0.42
        && features.flatness >= 0.12
      ) frames.push({ offset, ...features });
    }
    if (!frames.length) continue;

    const groups = [[frames[0]]];
    for (const frame of frames.slice(1)) {
      const group = groups.at(-1);
      const previousEnd = (group.at(-1).offset + frameSize) / sampleRate;
      if (frame.offset / sampleRate <= previousEnd + 0.031) group.push(frame);
      else groups.push([frame]);
    }
    for (const group of groups) {
      const start = Math.max(gapStart, group[0].offset / sampleRate);
      const end = Math.min(gapEnd, (group.at(-1).offset + frameSize) / sampleRate);
      if (end - start < minimumDuration - 0.001) continue;
      const average = (key) => group.reduce((sum, frame) => sum + frame[key], 0) / group.length;
      const highRatio = average("highRatio");
      const flatness = average("flatness");
      const confidence = Math.min(
        0.97,
        0.72
          + Math.min(0.12, (end - start - minimumDuration) * 0.4)
          + Math.min(0.08, Math.max(0, highRatio - 0.42) * 0.4)
          + Math.min(0.05, Math.max(0, flatness - 0.12) * 0.25),
      );
      breaths.push({
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        duration: Number((end - start).toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        mean_db: Number(average("levelDb").toFixed(2)),
        evidence: "broadband_nonverbal_audio_between_words",
      });
    }
  }
  return breaths;
}

export function analyzeSilence(samples, sampleRate, thresholdDb = -40, maximumSilence = 0.2) {
  const runs = detectAudioSilences(samples, sampleRate, {
    thresholdDb,
    minimumDuration: 0,
  }).map((run) => ({ start: run.start, end: run.end, duration: run.duration }));
  return {
    threshold_db: thresholdDb,
    maximum_allowed_silence: maximumSilence,
    maximum_measured_silence: Number(Math.max(0, ...runs.map((run) => run.duration)).toFixed(3)),
    long_silences: runs.filter((run) => run.duration > maximumSilence + 0.001),
  };
}
