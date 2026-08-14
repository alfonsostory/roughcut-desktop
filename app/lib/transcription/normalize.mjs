const round = (value) => Math.round(value * 1000) / 1000;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const nonSpeechOpeningToken = (value) => {
  const token = value.trim();
  const wrapped = (
    (token.startsWith("[") && token.endsWith("]"))
    || (token.startsWith("(") && token.endsWith(")"))
    || (token.startsWith("<") && token.endsWith(">"))
  );
  return !/[\p{L}\p{N}]/u.test(token)
    || (wrapped && /(music|noise|sound|applause|laughter|breath|silence|inaudible)/iu.test(token))
    || /[♪♫]/u.test(token);
};

export function findFirstRecognizableWord(words, minimumConfidence = 0.55) {
  const lexicalIndexes = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word || typeof word.word !== "string" || nonSpeechOpeningToken(word.word)) continue;
    lexicalIndexes.push(index);
    if (!isFiniteNumber(word.confidence) || word.confidence >= minimumConfidence) {
      return {
        index,
        word,
        confidence: isFiniteNumber(word.confidence) ? word.confidence : null,
        ignoredLeadingTokens: index,
        usedLowConfidenceFallback: false,
      };
    }
  }

  const fallbackIndex = lexicalIndexes[0] ?? 0;
  const fallbackWord = words[fallbackIndex];
  return {
    index: fallbackIndex,
    word: fallbackWord,
    confidence: isFiniteNumber(fallbackWord?.confidence) ? fallbackWord.confidence : null,
    ignoredLeadingTokens: fallbackIndex,
    usedLowConfidenceFallback: true,
  };
}

export function normalizeTranscriptPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.words)) {
    throw new Error("Transcript must contain a words array.");
  }

  let previousStart = -1;
  const words = payload.words.map((item, index) => {
    const word = typeof item?.word === "string" ? item.word.trim() : "";
    if (!word || !isFiniteNumber(item?.start) || !isFiniteNumber(item?.end)) {
      throw new Error(`Word ${index + 1} is missing text or timestamps.`);
    }
    if (item.start < 0 || item.end <= item.start) {
      throw new Error(`Word ${index + 1} has an invalid time range.`);
    }
    if (item.start < previousStart) {
      throw new Error("Word timestamps must be in chronological order.");
    }
    previousStart = item.start;

    const normalized = {
      word,
      start: round(item.start),
      end: round(item.end),
    };
    if (isFiniteNumber(item.confidence)) {
      normalized.confidence = Math.max(0, Math.min(1, item.confidence));
    }
    return normalized;
  });

  if (words.length === 0) throw new Error("No timed words were detected.");

  const lastWordEnd = words.at(-1).end;
  const suppliedDuration = isFiniteNumber(payload.duration) ? payload.duration : 0;
  const audioAnalysis = payload.audio_analysis && typeof payload.audio_analysis === "object"
    ? {
        frame_duration: isFiniteNumber(payload.audio_analysis.frame_duration)
          ? payload.audio_analysis.frame_duration
          : 0.01,
        silence_threshold_db: isFiniteNumber(payload.audio_analysis.silence_threshold_db)
          ? payload.audio_analysis.silence_threshold_db
          : -40,
        minimum_silence: isFiniteNumber(payload.audio_analysis.minimum_silence)
          ? payload.audio_analysis.minimum_silence
          : 0.2,
        silences: Array.isArray(payload.audio_analysis.silences)
          ? payload.audio_analysis.silences
            .filter((item) => isFiniteNumber(item?.start) && isFiniteNumber(item?.end) && item.end > item.start)
            .map((item) => ({
              start: round(Math.max(0, item.start)),
              end: round(item.end),
              duration: round(item.end - item.start),
              minimum_db: isFiniteNumber(item.minimum_db) ? item.minimum_db : undefined,
            }))
          : [],
        breaths: Array.isArray(payload.audio_analysis.breaths)
          ? payload.audio_analysis.breaths
            .filter((item) => isFiniteNumber(item?.start) && isFiniteNumber(item?.end) && item.end > item.start)
            .map((item) => ({
              start: round(Math.max(0, item.start)),
              end: round(item.end),
              duration: round(item.end - item.start),
              confidence: isFiniteNumber(item.confidence)
                ? Math.max(0, Math.min(1, item.confidence))
                : 0.75,
              mean_db: isFiniteNumber(item.mean_db) ? item.mean_db : undefined,
              evidence: typeof item.evidence === "string" ? item.evidence : undefined,
            }))
          : [],
      }
    : undefined;

  return {
    ...payload,
    duration: round(Math.max(suppliedDuration, lastWordEnd)),
    words,
    semantic_hints: Array.isArray(payload.semantic_hints) ? payload.semantic_hints : [],
    audio_analysis: audioAnalysis,
    opening_word: findFirstRecognizableWord(words),
  };
}
