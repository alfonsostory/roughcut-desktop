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
  .map((segment) => lexicalTokens(segment).map(normalizeToken).filter(Boolean))
  .filter((tokens) => tokens.length >= 4 && tokens.length <= 40);

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

const occurrenceScore = (tokens, segment, start) => {
  if (start + segment.length > tokens.length) return 0;
  let score = 0;
  for (let offset = 0; offset < segment.length; offset += 1) {
    const similarity = tokenSimilarity(tokens[start + offset], segment[offset]);
    score += similarity >= 0.86 ? similarity : 0;
  }
  return score / segment.length;
};

const meaningfulTerms = (words) => words
  .map((word) => normalizeToken(word.word))
  .filter((term) => term.length > 3 && !FILLER_TERMS.has(term));

export function detectScriptRetakeHints(words, script, { retakeWindow = 25 } = {}) {
  const tokens = words.map((word) => normalizeToken(word.word));
  const proposals = [];

  for (const segment of scriptSegments(script)) {
    const occurrences = [];
    for (let start = 0; start + segment.length <= tokens.length; start += 1) {
      const score = occurrenceScore(tokens, segment, start);
      if (score < 0.82) continue;
      if (occurrences.at(-1)?.end >= start) continue;
      occurrences.push({ start, end: start + segment.length - 1, score });
    }

    for (let index = 1; index < occurrences.length; index += 1) {
      const earlier = occurrences[index - 1];
      const later = occurrences[index];
      if (words[later.start].start - words[earlier.start].start > retakeWindow) continue;
      const keptTerms = new Set(meaningfulTerms(words.slice(later.start, later.end + 1)));
      const uniqueTerms = [...new Set(
        meaningfulTerms(words.slice(earlier.start, later.start))
          .filter((term) => !keptTerms.has(term)),
      )];
      proposals.push({
        kind: "retake",
        earlierWordRange: [earlier.start, later.start - 1],
        keptWordRange: [later.start, later.end],
        confidence: Math.min(0.97, 0.84 + Math.min(earlier.score, later.score) * 0.13),
        reason: "The supplied script line appears in two nearby takes; the final complete take is preferred.",
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
