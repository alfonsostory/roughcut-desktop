const FILLER_TERMS = new Set([
  "actually", "basically", "okay", "right", "sorry", "well",
]);

const normalizeToken = (value) => String(value ?? "")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}']/gu, "");

const lexicalTokens = (text) => String(text ?? "")
  .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];

const levenshteinDistance = (left, right) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous.at(-1);
};

const tokenSimilarity = (left, right) => {
  const normalizedLeft = normalizeToken(left);
  const normalizedRight = normalizeToken(right);
  const length = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!length) return 0;
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / length;
};

const scriptTokenRecords = (script) => lexicalTokens(script).map((text) => ({
  text,
  normalized: normalizeToken(text),
}));

const scriptSegments = (script) => String(script ?? "")
  .split(/\n+/)
  .flatMap((line) => line.match(/[^.!?]+[.!?]?/g) ?? [])
  .flatMap((segment) => {
    const tokens = lexicalTokens(segment).map(normalizeToken).filter(Boolean);
    if (tokens.length <= 40) return [tokens];
    const chunks = [];
    for (let start = 0; start < tokens.length; start += 24) chunks.push(tokens.slice(start, start + 32));
    return chunks;
  })
  .filter((tokens) => tokens.length >= 3);

const preservePunctuation = (replacement, original) => {
  const trailing = String(original).match(/[.,!?;:…]+$/u)?.[0] ?? "";
  return `${replacement}${trailing}`;
};

const surroundingSimilarity = (words, wordIndex, scriptWords, scriptIndex, offset) => {
  const transcriptToken = normalizeToken(words[wordIndex + offset]?.word);
  const scriptToken = scriptWords[scriptIndex + offset]?.normalized ?? "";
  if (!transcriptToken || !scriptToken) return 0;
  return tokenSimilarity(transcriptToken, scriptToken);
};

export function findScriptAssistedCorrections(words, script) {
  const scriptWords = scriptTokenRecords(script);
  if (!scriptWords.length) return [];

  return words.flatMap((word, wordIndex) => {
    const original = normalizeToken(word.word);
    if (!original || scriptWords.some((item) => item.normalized === original)) return [];

    let best;
    let secondBestScore = 0;
    for (let scriptIndex = 0; scriptIndex < scriptWords.length; scriptIndex += 1) {
      const candidate = scriptWords[scriptIndex];
      const acronym = /^[A-Z0-9]{2,}$/.test(candidate.text);
      if (candidate.normalized.length < 4 && !acronym) continue;
      const spelling = tokenSimilarity(original, candidate.normalized);
      const previous = surroundingSimilarity(words, wordIndex, scriptWords, scriptIndex, -1);
      const next = surroundingSimilarity(words, wordIndex, scriptWords, scriptIndex, 1);
      const contextMatches = Number(previous >= 0.88) + Number(next >= 0.88);
      const score = spelling * 0.7 + Math.max(previous, next) * 0.18 + Math.min(previous, next) * 0.12;
      const lowConfidence = typeof word.confidence === "number" && word.confidence < 0.68;
      const minimumSpelling = acronym ? 0.6 : 0.72;
      const eligible = (
        lowConfidence
        && spelling >= minimumSpelling
        && contextMatches >= 1
      ) || (
        spelling >= (acronym ? 0.6 : 0.62)
        && contextMatches === 2
      );
      if (!eligible) continue;

      if (!best || score > best.score) {
        secondBestScore = best?.score ?? secondBestScore;
        best = { candidate, score, spelling, contextMatches };
      } else {
        secondBestScore = Math.max(secondBestScore, score);
      }
    }

    if (!best || (best.score - secondBestScore < 0.035 && best.spelling < 0.9)) return [];
    return [{
      word_index: wordIndex,
      original_text: word.word,
      corrected_text: preservePunctuation(best.candidate.text, word.word),
      confidence: Math.min(0.98, 0.76 + best.spelling * 0.12 + best.contextMatches * 0.05),
      reason: "Matched the supplied recording script using neighboring spoken words.",
      status: "applied",
    }];
  });
}

export function applyTranscriptCorrections(words, corrections = []) {
  const applied = new Map(corrections
    .filter((correction) => correction.status === "applied")
    .map((correction) => [correction.word_index, correction.corrected_text]));
  return words.map((word, index) => applied.has(index)
    ? { ...word, word: applied.get(index) }
    : word);
}

const alignOccurrence = (tokens, segment, start, endLimit = tokens.length) => {
  const maximumEnd = Math.min(endLimit, start + segment.length + 8);
  let transcriptIndex = start;
  let scriptIndex = 0;
  const matches = [];

  while (transcriptIndex < maximumEnd && scriptIndex < segment.length) {
    let best;
    for (let transcriptSkip = 0; transcriptSkip <= 3; transcriptSkip += 1) {
      const candidateTranscriptIndex = transcriptIndex + transcriptSkip;
      if (candidateTranscriptIndex >= maximumEnd) break;
      for (let scriptSkip = 0; scriptSkip <= 2; scriptSkip += 1) {
        const candidateScriptIndex = scriptIndex + scriptSkip;
        if (candidateScriptIndex >= segment.length) break;
        const similarity = tokenSimilarity(
          tokens[candidateTranscriptIndex],
          segment[candidateScriptIndex],
        );
        const rank = similarity - transcriptSkip * 0.055 - scriptSkip * 0.075;
        if (similarity < 0.68 || rank < 0.54) continue;
        if (!best || rank > best.rank) {
          best = {
            transcriptIndex: candidateTranscriptIndex,
            scriptIndex: candidateScriptIndex,
            similarity,
            rank,
          };
        }
      }
    }
    if (!best) {
      transcriptIndex += 1;
      continue;
    }
    matches.push(best);
    transcriptIndex = best.transcriptIndex + 1;
    scriptIndex = best.scriptIndex + 1;
  }

  if (!matches.length) return undefined;
  const first = matches[0];
  const last = matches.at(-1);
  const inferredStart = Math.max(start, first.transcriptIndex - first.scriptIndex);
  const spanLength = last.transcriptIndex - inferredStart + 1;
  const coverage = matches.length / segment.length;
  const precision = matches.length / Math.max(1, spanLength);
  const averageSimilarity = matches.reduce((sum, match) => sum + match.similarity, 0) / matches.length;
  const prefixReach = last.scriptIndex + 1;
  const prefixCoverage = matches.length / prefixReach;
  const complete = (
    matches.length >= Math.min(4, Math.ceil(segment.length * 0.68))
    && coverage >= 0.68
    && precision >= 0.5
    && averageSimilarity >= 0.8
    && first.scriptIndex <= 1
    && last.scriptIndex >= segment.length - 2
  );
  const partial = (
    !complete
    && matches.length >= Math.min(3, segment.length - 1)
    && prefixReach >= Math.min(3, Math.ceil(segment.length * 0.35))
    && prefixCoverage >= 0.72
    && precision >= 0.45
    && averageSimilarity >= 0.8
    && first.scriptIndex <= 1
  );
  return {
    start: inferredStart,
    end: last.transcriptIndex,
    score: coverage * 0.55 + precision * 0.2 + averageSimilarity * 0.25,
    complete,
    partial,
  };
};

const candidateStarts = (tokens, segment, start = 0, end = tokens.length) => {
  const starts = new Set();
  const anchorCount = Math.min(3, segment.length);
  for (let transcriptIndex = start; transcriptIndex < end; transcriptIndex += 1) {
    for (let scriptIndex = 0; scriptIndex < anchorCount; scriptIndex += 1) {
      if (tokenSimilarity(tokens[transcriptIndex], segment[scriptIndex]) < 0.72) continue;
      starts.add(Math.max(start, transcriptIndex - scriptIndex));
    }
  }
  return [...starts].sort((left, right) => left - right);
};

const dedupeOccurrences = (occurrences) => {
  const ranked = [...occurrences].sort((left, right) =>
    right.score - left.score || left.start - right.start || left.end - right.end);
  const accepted = [];
  for (const occurrence of ranked) {
    if (accepted.some((item) => occurrence.start <= item.end && occurrence.end >= item.start)) continue;
    accepted.push(occurrence);
  }
  return accepted.sort((left, right) => left.start - right.start);
};

const meaningfulTerms = (words) => words
  .map((word) => normalizeToken(word.word))
  .filter((term) => term.length > 3 && !FILLER_TERMS.has(term));

export function detectScriptRetakeHints(words, script, { retakeWindow = 25 } = {}) {
  const tokens = words.map((word) => normalizeToken(word.word));
  const proposals = [];

  for (const segment of scriptSegments(script)) {
    const completeOccurrences = dedupeOccurrences(candidateStarts(tokens, segment)
      .map((start) => alignOccurrence(tokens, segment, start))
      .filter((occurrence) => occurrence?.complete));

    for (const later of completeOccurrences) {
      const earliestTime = words[later.start].start - retakeWindow;
      let earliestWord = later.start - 1;
      while (earliestWord > 0 && words[earliestWord].start >= earliestTime) earliestWord -= 1;
      if (words[earliestWord]?.start < earliestTime) earliestWord += 1;
      const earlierCandidates = candidateStarts(tokens, segment, earliestWord, later.start)
        .map((start) => alignOccurrence(tokens, segment, start, later.start))
        .filter((occurrence) => occurrence && (occurrence.complete || occurrence.partial));
      const earlier = earlierCandidates
        .filter((occurrence) => occurrence.start < later.start && occurrence.end < later.start)
        .sort((left, right) =>
          Number(right.complete) - Number(left.complete)
          || right.score - left.score
          || right.start - left.start)[0];
      if (!earlier) continue;

      const keptTerms = new Set(meaningfulTerms(words.slice(later.start, later.end + 1)));
      const uniqueTerms = [...new Set(
        meaningfulTerms(words.slice(earlier.start, later.start))
          .filter((term) => !keptTerms.has(term)),
      )];
      proposals.push({
        kind: "retake",
        earlierWordRange: [earlier.start, later.start - 1],
        keptWordRange: [later.start, later.end],
        confidence: Math.min(
          0.97,
          (earlier.complete ? 0.84 : 0.8) + Math.min(earlier.score, later.score) * 0.13,
        ),
        reason: earlier.complete
          ? "The supplied script line appears in two nearby takes; the final complete take is preferred."
          : "An earlier attempt matches the opening of the supplied script line, then restarts into a later complete take.",
        uniqueTerms,
      });
    }
  }

  proposals.sort((left, right) =>
    right.confidence - left.confidence
    || left.earlierWordRange[0] - right.earlierWordRange[0]);
  return proposals.filter((proposal, index) => !proposals.slice(0, index).some((accepted) =>
    accepted.earlierWordRange[0] === proposal.earlierWordRange[0]
    && accepted.keptWordRange[0] === proposal.keptWordRange[0]));
}

export function analyzeSupportingScript(words, script, options = {}) {
  const trimmedScript = String(script ?? "").trim();
  if (!trimmedScript) {
    return {
      corrections: [],
      correctedWords: words,
      semanticHints: [],
      scriptWordCount: 0,
      matchedWordCount: 0,
    };
  }

  const corrections = findScriptAssistedCorrections(words, trimmedScript);
  const correctedWords = applyTranscriptCorrections(words, corrections);
  const scriptVocabulary = new Set(scriptTokenRecords(trimmedScript).map((item) => item.normalized));
  const matchedWordCount = correctedWords.filter((word) => scriptVocabulary.has(normalizeToken(word.word))).length;
  return {
    corrections,
    correctedWords,
    semanticHints: detectScriptRetakeHints(correctedWords, trimmedScript, options),
    scriptWordCount: scriptTokenRecords(trimmedScript).length,
    matchedWordCount,
  };
}
