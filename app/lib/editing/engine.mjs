const round = (value) => Math.round(value * 1000) / 1000;

export const DEFAULT_CONFIG = Object.freeze({
  longPauseThreshold: 0.2,
  targetPause: 0.18,
  minimumSpeechSide: 0.09,
  speechSafetyPadding: 0.09,
  retakeSpeechPadding: 0.1,
  minimumTransition: 0.18,
  retakeWindow: 25,
});

function overlapsWordBoundary(boundary, words) {
  return words.some((word) => boundary > word.start && boundary < word.end);
}

function surroundingWords(words, start, end) {
  return {
    before: [...words].reverse().find((word) => word.end <= start),
    after: words.find((word) => word.start >= end),
  };
}

export function validateCut(cut, words, config = DEFAULT_CONFIG) {
  const issues = [];
  const { before, after } = surroundingWords(words, cut.start, cut.end);

  if (cut.end <= cut.start) issues.push("Cut has no removable duration.");
  if (overlapsWordBoundary(cut.start, words)) issues.push("Start boundary intersects a spoken word.");
  if (overlapsWordBoundary(cut.end, words)) issues.push("End boundary intersects a spoken word.");

  if (before && cut.start - before.end < config.minimumSpeechSide - 0.001) {
    issues.push("Less than the minimum tail padding remains after the previous word.");
  }
  if (after && after.start - cut.end < config.minimumSpeechSide - 0.001) {
    issues.push("Less than the minimum lead padding remains before the next word.");
  }

  const resultingGap =
    (before ? cut.start - before.end : 0) + (after ? after.start - cut.end : 0);
  if (before && after && resultingGap < config.minimumTransition - 0.001) {
    issues.push("The resulting transition is unnaturally tight.");
  }

  return {
    valid: issues.length === 0,
    issues,
    resultingGap: round(resultingGap),
  };
}

function contextText(words, startIndex, endIndex, radius = 5) {
  return words
    .slice(Math.max(0, startIndex - radius), Math.min(words.length, endIndex + radius + 1))
    .map((word) => word.word)
    .join(" ");
}

function createSilenceCut(words, previousIndex, config) {
  const previous = words[previousIndex];
  const next = words[previousIndex + 1];
  const pause = next.start - previous.end;
  const eachSide = Math.max(
    config.minimumSpeechSide,
    config.speechSafetyPadding,
    config.targetPause / 2,
  );
  const start = round(previous.end + eachSide);
  const end = round(next.start - eachSide);
  const validation = validateCut({ start, end }, words, config);

  return {
    id: `silence-${previousIndex}-${round(previous.end)}`,
    start,
    end,
    type: "silence",
    confidence: Math.min(0.99, round(0.82 + Math.min(pause - config.longPauseThreshold, 1.5) * 0.1)),
    risk: validation.valid ? "low" : "high",
    reason: `Shorten a ${pause.toFixed(2)}s pause to ${validation.resultingGap.toFixed(2)}s.`,
    original_text: `${previous.word}  [${pause.toFixed(2)}s pause]  ${next.word}`,
    resulting_text: `${previous.word}  [${validation.resultingGap.toFixed(2)}s pause]  ${next.word}`,
    status: "approved",
    validation,
    sourceWordRange: null,
  };
}

function createMergedSilenceCut(words, proposal, index, config) {
  const { before, after } = surroundingWords(words, proposal.start, proposal.end);
  const openingEvidence = proposal.evidence.find((item) => item.source === "opening_word");
  const leadingAudioEvidence = proposal.evidence.find(
    (item) => item.source === "audio_energy" && item.position === "leading",
  );
  const validationWords = openingEvidence
    ? words.slice(openingEvidence.openingWordIndex)
    : words;
  const transcriptValidation = validateCut(proposal, validationWords, config);
  const silenceVerified = proposal.sources.has("audio_energy");
  const breathDetected = proposal.sources.has("breath");
  const audioVerified = silenceVerified || breathDetected;
  const validation = silenceVerified
    ? {
        valid: proposal.end > proposal.start,
        issues: [],
        resultingGap: round(config.targetPause),
      }
    : transcriptValidation;
  const position = !before ? "leading" : !after ? "trailing" : "internal";
  const originalPause = round(
    position === "leading"
      ? leadingAudioEvidence?.end ?? after?.start ?? proposal.end
      : position === "trailing"
        ? proposal.end - (before?.end ?? proposal.start)
        : after.start - before.end,
  );
  const remainingPause = round(
    position === "leading"
      ? leadingAudioEvidence
        ? leadingAudioEvidence.end - proposal.end
        : (after?.start ?? proposal.end) - proposal.end
      : position === "trailing"
        ? proposal.start - (before?.end ?? proposal.start)
        : validation.resultingGap,
  );
  const originalText = position === "leading"
    ? openingEvidence?.ignoredText
      ? `[opening noise: ${openingEvidence.ignoredText}]  ${after?.word ?? ""}`
      : `[${originalPause.toFixed(2)}s leading silence]  ${words.find((word) => word.end > proposal.end)?.word ?? after?.word ?? ""}`
    : position === "trailing"
      ? `${before?.word ?? ""}  [${originalPause.toFixed(2)}s trailing silence]`
      : `${before.word}  [${originalPause.toFixed(2)}s pause]  ${after.word}`;
  const resultingText = position === "leading"
    ? `[${remainingPause.toFixed(2)}s safe pre-roll]  ${words.find((word) => word.end > proposal.end)?.word ?? after?.word ?? ""}`
    : position === "trailing"
      ? `${before?.word ?? ""}  [trimmed tail]`
      : `${before.word}  [${config.targetPause.toFixed(2)}s pause]  ${after.word}`;
  const sourceLabel = openingEvidence
    ? `Opening scan selected “${openingEvidence.word}” as the first recognizable word and ignored ${openingEvidence.ignoredLeadingTokens} earlier noise token${openingEvidence.ignoredLeadingTokens === 1 ? "" : "s"}.`
    : breathDetected
      ? "Breath-like broadband audio was detected inside a timestamp-confirmed word gap."
      : silenceVerified
        ? leadingAudioEvidence
          ? "Measured opening silence ends at the first detected audio activity."
          : `Audio energy below ${proposal.thresholdDb ?? -40} dB confirms the removable region.`
        : "Word timestamps confirm the removable region.";
  const actionLabel = position === "leading"
    ? `Trim opening silence to ${remainingPause.toFixed(2)}s of word-safe pre-roll.`
    : `Shorten ${position} silence toward ${config.targetPause.toFixed(2)}s.`;

  return {
    id: `silence-merged-${index}-${round(proposal.start)}`,
    start: round(proposal.start),
    end: round(proposal.end),
    type: "silence",
    confidence: silenceVerified
      ? 0.98
      : breathDetected
        ? Math.max(0.82, ...proposal.evidence.filter((item) => item.source === "breath").map((item) => item.confidence ?? 0.82))
        : 0.9,
    risk: validation.valid ? "low" : "high",
    reason: `${sourceLabel} ${actionLabel}`,
    original_text: originalText,
    resulting_text: resultingText,
    status: "approved",
    validation,
    sourceWordRange: openingEvidence?.openingWordIndex > 0
      ? [0, openingEvidence.openingWordIndex - 1]
      : null,
    audioVerified,
    breathDetected,
    openingTrim: position === "leading",
    evidence: proposal.evidence,
  };
}

function mergeSilenceProposals(proposals) {
  const merged = [];
  for (const proposal of proposals
    .filter((item) => item.end - item.start > 0.001)
    .sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && proposal.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, proposal.end);
      for (const source of proposal.sources) previous.sources.add(source);
      previous.evidence.push(...proposal.evidence);
      if (proposal.thresholdDb !== undefined) previous.thresholdDb = proposal.thresholdDb;
    } else {
      merged.push({
        ...proposal,
        sources: new Set(proposal.sources),
        evidence: [...proposal.evidence],
      });
    }
  }
  return merged;
}

function generateSilenceCandidates(words, config, analysis) {
  if (!words.length) return [];
  const proposals = [];
  const duration = analysis.duration ?? words.at(-1).end;
  const side = Math.max(config.minimumSpeechSide, config.speechSafetyPadding, config.targetPause / 2);
  const leadingAudioSilence = (analysis.audioSilences ?? [])
    .filter((silence) => silence.start <= 0.02 && silence.end - silence.start > config.longPauseThreshold + 0.001)
    .sort((left, right) => right.end - left.end)[0];

  for (let index = 0; index < words.length - 1; index += 1) {
    const previous = words[index];
    const next = words[index + 1];
    const pause = next.start - previous.end;
    if (pause > config.longPauseThreshold + 0.001) {
      proposals.push({
        start: previous.end + side,
        end: next.start - side,
        sources: ["word_timestamps"],
        evidence: [{ source: "word_timestamps", pause: round(pause) }],
      });
    }
  }

  // Opening noise is anchored to the first recognizable transcript word, not
  // the first low-confidence token. The word still keeps safety pre-roll.
  const requestedOpeningIndex = Number.isInteger(analysis.openingWordIndex)
    ? analysis.openingWordIndex
    : 0;
  const openingWordIndex = Math.max(0, Math.min(words.length - 1, requestedOpeningIndex));
  const openingWord = words[openingWordIndex];
  if (leadingAudioSilence && leadingAudioSilence.end > side + 0.001) {
    proposals.push({
      start: 0,
      end: leadingAudioSilence.end - side,
      sources: ["audio_energy"],
      thresholdDb: analysis.silenceThresholdDb ?? -40,
      evidence: [{ source: "audio_energy", position: "leading", ...leadingAudioSilence }],
    });
  } else if (openingWord.start > side + 0.001) {
    proposals.push({
      start: 0,
      end: openingWord.start - side,
      sources: ["word_timestamps", "opening_word"],
      evidence: [{
        source: "opening_word",
        position: "leading",
        word: openingWord.word,
        confidence: analysis.openingWordConfidence ?? openingWord.confidence ?? null,
        openingWordIndex,
        ignoredLeadingTokens: openingWordIndex,
        ignoredText: words.slice(0, openingWordIndex).map((word) => word.word).join(" "),
      }],
    });
  }
  if (duration - words.at(-1).end > config.longPauseThreshold + 0.001) {
    proposals.push({
      start: words.at(-1).end + side,
      end: duration,
      sources: ["word_timestamps"],
      evidence: [{ source: "word_timestamps", position: "trailing" }],
    });
  }

  for (const silence of analysis.audioSilences ?? []) {
    if (silence.end - silence.start <= config.longPauseThreshold + 0.001) continue;
    if (silence.start <= 0.02 || silence.end >= duration - 0.06) continue;
    proposals.push({
      start: silence.start + side,
      end: silence.end - side,
      sources: ["audio_energy"],
      thresholdDb: analysis.silenceThresholdDb ?? -40,
      evidence: [{ source: "audio_energy", ...silence }],
    });
  }

  for (const breath of analysis.audioBreaths ?? []) {
    const before = [...words].reverse().find((word) => word.end <= breath.start + 0.001);
    const after = words.find((word) => word.start >= breath.end - 0.001);
    if (!before || !after) continue;
    if (breath.start < before.end - 0.001 || breath.end > after.start + 0.001) continue;
    const wordGap = after.start - before.end;
    if (wordGap <= Math.max(config.minimumTransition, side * 2) + 0.001) continue;
    proposals.push({
      start: before.end + side,
      end: after.start - side,
      sources: ["breath"],
      evidence: [{ source: "breath", ...breath, wordGap: round(wordGap) }],
    });
  }

  return mergeSilenceProposals(proposals)
    .map((proposal, index) => createMergedSilenceCut(words, proposal, index, config));
}

function findMeasuredSpeechOnset(kept, removedEnd, audioSilences = []) {
  return audioSilences
    .filter((silence) => (
      silence.end > removedEnd
      && silence.end <= kept.start
      && kept.start - silence.end <= 0.5
    ))
    .sort((left, right) => right.end - left.end)[0];
}

function createSemanticCut(words, hint, config, analysis = {}) {
  const [earlierStart] = hint.earlierWordRange;
  const [laterStart] = hint.keptWordRange;
  const previous = words[earlierStart - 1];
  const kept = words[laterStart];
  const removedWords = words.slice(earlierStart, laterStart);
  const removedEnd = removedWords.at(-1)?.end ?? 0;
  const measuredOnset = findMeasuredSpeechOnset(kept, removedEnd, analysis.audioSilences);
  const protectedOnset = measuredOnset?.end ?? kept.start;
  const retakePadding = config.retakeSpeechPadding ?? Math.max(0.1, config.speechSafetyPadding);
  const start = round(previous ? previous.end + retakePadding : 0);
  const end = round(protectedOnset - retakePadding);
  const removedText = removedWords.map((word) => word.word).join(" ");
  const uniqueTerms = hint.uniqueTerms ?? [];
  const validation = validateCut({ start, end }, words, config);
  const highRisk = uniqueTerms.length > 0 || !validation.valid || hint.confidence < 0.8;
  const type = hint.kind === "repetition" ? "repetition" : "retake";

  return {
    id: `${type}-${earlierStart}-${laterStart}`,
    start,
    end,
    type,
    confidence: hint.confidence,
    risk: highRisk ? "high" : hint.confidence < 0.9 ? "medium" : "low",
    reason: `${uniqueTerms.length
      ? `${hint.reason} Unique information detected: ${uniqueTerms.join(", ")}.`
      : hint.reason}${measuredOnset
      ? ` Audio energy places the retained speech onset ${Math.round((kept.start - measuredOnset.end) * 1000)} ms before its word timestamp.`
      : ""}`,
    original_text: contextText(words, earlierStart, laterStart - 1),
    resulting_text: contextText(words, laterStart, hint.keptWordRange[1]),
    status: "approved",
    validation,
    sourceWordRange: [earlierStart, laterStart - 1],
    semanticHint: {
      removedText,
      keptText: words
        .slice(hint.keptWordRange[0], hint.keptWordRange[1] + 1)
        .map((word) => word.word)
        .join(" "),
      uniqueTerms,
    },
    audioVerified: Boolean(measuredOnset),
    evidence: measuredOnset ? [{
      source: "audio_energy",
      purpose: "retained_speech_onset",
      transcript_word_start: kept.start,
      measured_speech_onset: measuredOnset.end,
      retained_preroll: retakePadding,
    }] : [],
  };
}

export function generateCandidateCuts(words, semanticHints = [], partialConfig = {}, analysis = {}) {
  const config = { ...DEFAULT_CONFIG, ...partialConfig };
  const candidates = analysis.audioSilences || analysis.duration
    ? generateSilenceCandidates(words, config, analysis)
    : [];

  if (!analysis.audioSilences && !analysis.duration) {
    for (let index = 0; index < words.length - 1; index += 1) {
      if (words[index + 1].start - words[index].end > config.longPauseThreshold + 0.001) {
        candidates.push(createSilenceCut(words, index, config));
      }
    }
  }

  for (const hint of semanticHints) {
    candidates.push(createSemanticCut(words, hint, config, analysis));
  }

  return candidates.sort((a, b) => a.start - b.start);
}

export function buildEdl(duration, candidates) {
  const approved = candidates
    .filter((cut) => cut.status === "approved" && cut.validation.valid)
    .sort((a, b) => a.start - b.start);

  const removals = [];
  for (const cut of approved) {
    const previous = removals.at(-1);
    if (previous && cut.start <= previous.end) {
      previous.end = Math.max(previous.end, cut.end);
      previous.candidateCutIds.push(cut.id);
    } else {
      removals.push({ start: cut.start, end: cut.end, candidateCutIds: [cut.id] });
    }
  }

  const ranges = [];
  let cursor = 0;
  for (const cut of removals) {
    if (cut.start > cursor) ranges.push({ start: round(cursor), end: round(cut.start), action: "keep" });
    ranges.push({ start: round(cut.start), end: round(cut.end), action: "remove", candidateCutIds: cut.candidateCutIds });
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < duration) ranges.push({ start: round(cursor), end: round(duration), action: "keep" });
  return ranges;
}

function wordIsRemoved(word, wordIndex, approvedCuts) {
  return approvedCuts.some((cut) => (
    word.start >= cut.start && word.end <= cut.end
  ) || (
    cut.sourceWordRange
    && wordIndex >= cut.sourceWordRange[0]
    && wordIndex <= cut.sourceWordRange[1]
  ));
}

export function validateEditedResult(words, candidates, config = DEFAULT_CONFIG) {
  const approved = candidates.filter(
    (cut) => cut.status === "approved" && cut.validation.valid,
  );
  const keptWords = words.filter((word, index) => !wordIsRemoved(word, index, approved));
  const missingUniqueWords = [];

  for (const cut of approved.filter((item) => item.semanticHint)) {
    for (const token of cut.semanticHint.uniqueTerms) missingUniqueWords.push(token);
  }

  const edl = buildEdl(words.at(-1)?.end ?? 0, candidates);
  const remainingLongPauses = [];
  for (let index = 0; index < keptWords.length - 1; index += 1) {
    const rawGap = keptWords[index + 1].start - keptWords[index].end;
    const removedWithinGap = edl
      .filter((range) => range.action === "remove")
      .reduce((sum, range) => sum + Math.max(
        0,
        Math.min(range.end, keptWords[index + 1].start)
          - Math.max(range.start, keptWords[index].end),
      ), 0);
    if (rawGap - removedWithinGap > config.longPauseThreshold) {
      remainingLongPauses.push({ after: keptWords[index].word, duration: round(rawGap - removedWithinGap) });
    }
  }

  return {
    reconstructedTranscript: keptWords.map((word) => word.word).join(" "),
    missingUniqueWords: [...new Set(missingUniqueWords)],
    remainingLongPauses,
    dangerousCuts: candidates.filter((cut) => cut.risk === "high" || !cut.validation.valid).map((cut) => cut.id),
    valid: missingUniqueWords.length === 0 && approved.every((cut) => cut.validation.valid),
  };
}
