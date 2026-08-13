import { DEFAULT_CONFIG } from "../editing/engine.mjs";

const round = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const token = (word) => word.toLowerCase().replace(/[^a-z0-9']/g, "");

const quantile = (values, percentile) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * percentile)];
};

export function alignTranscriptWords(sourceWords, editedWords) {
  const source = sourceWords.map((item) => token(item.word));
  const edited = editedWords.map((item) => token(item.word));
  const lengths = Array.from(
    { length: source.length + 1 },
    () => new Uint16Array(edited.length + 1),
  );

  for (let sourceIndex = source.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let editedIndex = edited.length - 1; editedIndex >= 0; editedIndex -= 1) {
      lengths[sourceIndex][editedIndex] = source[sourceIndex] === edited[editedIndex]
        ? lengths[sourceIndex + 1][editedIndex + 1] + 1
        : Math.max(lengths[sourceIndex + 1][editedIndex], lengths[sourceIndex][editedIndex + 1]);
    }
  }

  const pairs = [];
  let sourceIndex = 0;
  let editedIndex = 0;
  while (sourceIndex < source.length && editedIndex < edited.length) {
    if (source[sourceIndex] === edited[editedIndex]) {
      pairs.push([sourceIndex, editedIndex]);
      sourceIndex += 1;
      editedIndex += 1;
    } else if (lengths[sourceIndex + 1][editedIndex] >= lengths[sourceIndex][editedIndex + 1]) {
      sourceIndex += 1;
    } else {
      editedIndex += 1;
    }
  }
  return pairs;
}

function removedWordRuns(sourceWords, pairs) {
  const matched = new Set(pairs.map(([sourceIndex]) => sourceIndex));
  const runs = [];
  let start;
  for (let index = 0; index <= sourceWords.length; index += 1) {
    if (index < sourceWords.length && !matched.has(index)) {
      start ??= index;
    } else if (start !== undefined) {
      const end = index - 1;
      if (end - start + 1 >= 3) {
        runs.push({
          sourceWordRange: [start, end],
          start: sourceWords[start].start,
          end: sourceWords[end].end,
          text: sourceWords.slice(start, end + 1).map((item) => item.word).join(" "),
        });
      }
      start = undefined;
    }
  }
  return runs;
}

export function calibrateFromReferenceEdit(sourceTranscript, editedTranscript, baseConfig = DEFAULT_CONFIG) {
  const sourceWords = sourceTranscript.words ?? [];
  const editedWords = editedTranscript.words ?? [];
  const pairs = alignTranscriptWords(sourceWords, editedWords);
  const pauseSamples = [];

  for (let index = 1; index < pairs.length; index += 1) {
    const [previousSource, previousEdited] = pairs[index - 1];
    const [currentSource, currentEdited] = pairs[index];
    if (currentSource !== previousSource + 1 || currentEdited !== previousEdited + 1) continue;
    const sourceGap = sourceWords[currentSource].start - sourceWords[previousSource].end;
    const editedGap = editedWords[currentEdited].start - editedWords[previousEdited].end;
    if (sourceGap - editedGap <= 0.08) continue;
    pauseSamples.push({ sourceGap: round(sourceGap), editedGap: round(Math.max(0, editedGap)) });
  }

  const observedTrigger = quantile(pauseSamples.map((sample) => sample.sourceGap), 0.2);
  const observedTarget = quantile(pauseSamples.map((sample) => sample.editedGap), 0.5);
  const longPauseThreshold = observedTrigger === undefined
    ? baseConfig.longPauseThreshold
    : round(clamp(observedTrigger, 0.2, 1.5), 2);

  // The calibrated preset keeps two 90 ms speech-safe sides, yielding a
  // natural 180 ms target while retaining a hard 200 ms maximum.
  const minimumSafePause = baseConfig.minimumSpeechSide * 2;
  const targetPause = observedTarget === undefined
    ? baseConfig.targetPause
    : round(clamp(observedTarget, minimumSafePause, 0.25), 2);

  return {
    config: {
      ...baseConfig,
      longPauseThreshold,
      targetPause,
      speechSafetyPadding: Math.max(
        baseConfig.minimumSpeechSide,
        Math.min(baseConfig.speechSafetyPadding, targetPause / 2),
      ),
      minimumTransition: targetPause,
    },
    evidence: {
      sourceDuration: sourceTranscript.duration,
      editedDuration: editedTranscript.duration,
      durationRemoved: round((sourceTranscript.duration ?? 0) - (editedTranscript.duration ?? 0)),
      matchedWords: pairs.length,
      matchedWordRate: round(pairs.length / Math.max(sourceWords.length, editedWords.length, 1)),
      pauseSamples,
      observedTargetPause: observedTarget === undefined ? undefined : round(observedTarget),
      safetyConstrainedTarget: observedTarget !== undefined && observedTarget < minimumSafePause,
      removedWordRuns: removedWordRuns(sourceWords, pairs),
    },
  };
}
