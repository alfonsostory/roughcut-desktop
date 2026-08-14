export function getRemovedWordIndexes(words, candidates) {
  const removed = new Set();
  for (const cut of candidates) {
    if (cut.status !== "approved" || !cut.validation?.valid) continue;
    if (cut.sourceWordRange) {
      const [startIndex, endIndex] = cut.sourceWordRange;
      for (
        let index = Math.max(0, startIndex);
        index <= Math.min(words.length - 1, endIndex);
        index += 1
      ) removed.add(index);
      continue;
    }
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      if (word.start >= cut.start && word.end <= cut.end) removed.add(index);
    }
  }
  return removed;
}

export function reconstructParagraphTranscript(words, candidates) {
  const removed = getRemovedWordIndexes(words, candidates);
  return words
    .filter((_, index) => !removed.has(index))
    .map((word) => word.word)
    .join(" ");
}
