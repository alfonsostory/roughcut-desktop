const normalizeToken = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9']/g, "");

const endsSentence = (value) => /[.!?…]["')\]]*$/.test(value);

const sentenceEnd = (words, start, maximumWords = 24) => {
  const limit = Math.min(words.length - 1, start + maximumWords - 1);
  for (let index = start; index <= limit; index += 1) {
    if (endsSentence(words[index].word)) return index;
  }
  return limit;
};

const meaningfulTerms = (words) => words
  .map((item) => normalizeToken(item.word))
  .filter((item) => item.length > 3);

export function detectRetakeHints(words, { retakeWindow = 25, minimumRepeatedWords = 4 } = {}) {
  const tokens = words.map((item) => normalizeToken(item.word));
  const proposals = [];

  for (let laterStart = 1; laterStart < words.length; laterStart += 1) {
    for (let earlierStart = laterStart - 1; earlierStart >= 0; earlierStart -= 1) {
      if (words[laterStart].start - words[earlierStart].start > retakeWindow) break;
      if (!tokens[earlierStart] || tokens[earlierStart] !== tokens[laterStart]) continue;

      let repeatedWords = 0;
      while (
        earlierStart + repeatedWords < laterStart
        && laterStart + repeatedWords < words.length
        && tokens[earlierStart + repeatedWords] === tokens[laterStart + repeatedWords]
      ) repeatedWords += 1;
      if (repeatedWords < minimumRepeatedWords) continue;

      const earlierEnd = laterStart - 1;
      const keptEnd = sentenceEnd(words, laterStart);
      const earlierLength = laterStart - earlierStart;
      const keptLength = keptEnd - laterStart + 1;
      if (keptLength < repeatedWords + 2 || keptLength <= earlierLength) continue;

      const earlierSuffix = words.slice(earlierStart + repeatedWords, laterStart);
      const laterSentenceTokens = new Set(tokens.slice(laterStart, keptEnd + 1));
      const unmatchedTerms = meaningfulTerms(earlierSuffix)
        .filter((term) => !laterSentenceTokens.has(term));

      // Only a single-word divergence at the end of a completed first take is
      // treated as a likely correction (for example, a corrected name). Two
      // or more unmatched words remain attached as risk evidence so the
      // reviewer can see what the active-by-default cut would remove.
      const correctedShortSuffix = earlierSuffix.length === 1
        && repeatedWords >= 5
        && endsSentence(words[earlierEnd].word)
        && keptLength >= earlierLength + 4;
      const uniqueTerms = correctedShortSuffix ? [] : [...new Set(unmatchedTerms)];
      const confidence = Math.min(0.98, 0.82 + repeatedWords * 0.02 + (keptLength > earlierLength + 3 ? 0.04 : 0));

      proposals.push({
        kind: "retake",
        earlierWordRange: [earlierStart, earlierEnd],
        keptWordRange: [laterStart, keptEnd],
        confidence,
        reason: `A ${repeatedWords}-word opening repeats, and the later take continues into a more complete sentence.`,
        uniqueTerms,
        repeatedWords,
      });
    }
  }

  proposals.sort((left, right) =>
    right.repeatedWords - left.repeatedWords
    || right.confidence - left.confidence
    || left.earlierWordRange[0] - right.earlierWordRange[0]);

  const accepted = [];
  for (const proposal of proposals) {
    const [earlierStart, earlierEnd] = proposal.earlierWordRange;
    const [keptStart] = proposal.keptWordRange;
    const duplicatesAccepted = accepted.some((item) => {
      const [acceptedStart, acceptedEnd] = item.earlierWordRange;
      const [acceptedKept] = item.keptWordRange;
      return earlierStart <= acceptedEnd
        && earlierEnd >= acceptedStart
        && Math.abs(keptStart - acceptedKept) <= proposal.repeatedWords;
    });
    if (!duplicatesAccepted) accepted.push(proposal);
  }

  return accepted.map((hint) => {
    const result = { ...hint };
    delete result.repeatedWords;
    return result;
  });
}

export function mergeSemanticHints(explicitHints = [], detectedHints = []) {
  const result = [...explicitHints];
  for (const hint of detectedHints) {
    const duplicate = result.some((item) =>
      item.earlierWordRange?.[0] === hint.earlierWordRange[0]
      && item.keptWordRange?.[0] === hint.keptWordRange[0]);
    if (!duplicate) result.push(hint);
  }
  return result;
}
