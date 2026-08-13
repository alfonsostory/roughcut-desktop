import type { SemanticHint, WordTimestamp } from "./engine.mjs";

const phrases: Array<{ start: number; end: number; text: string }> = [
  { start: 0.5, end: 2.65, text: "The most important thing is" },
  { start: 3.7, end: 7.4, text: "The most important thing is to start with a clear story." },
  { start: 8.62, end: 11.1, text: "That gives every edit a purpose." },
  { start: 11.94, end: 13.2, text: "The next part is" },
  { start: 14.25, end: 17.45, text: "The next part is checking every cut by ear." },
  { start: 18.56, end: 22.5, text: "Then you can add visual polish and a surprising statistic." },
  { start: 23.1, end: 27.45, text: "Sorry, then you can add visual polish once the structure works." },
  { start: 28.58, end: 32.1, text: "The result should still sound completely natural." },
];

export const sampleWords: WordTimestamp[] = phrases.flatMap((phrase) => {
  const tokens = phrase.text.split(/\s+/);
  const step = (phrase.end - phrase.start) / tokens.length;
  return tokens.map((token, index) => {
    return {
      word: token,
      start: Number((phrase.start + index * step).toFixed(3)),
      end: Number((phrase.start + (index + 0.78) * step).toFixed(3)),
      confidence: 0.96,
    };
  });
});

function findRange(text: string, from = 0): [number, number] {
  const wanted = text.toLowerCase().split(/\s+/);
  for (let start = from; start <= sampleWords.length - wanted.length; start += 1) {
    const candidate = sampleWords.slice(start, start + wanted.length).map((word) => word.word.toLowerCase());
    if (candidate.join(" ") === wanted.join(" ")) return [start, start + wanted.length - 1];
  }
  throw new Error(`Sample phrase not found: ${text}`);
}

const firstIncomplete = findRange("The most important thing is");
const firstComplete = findRange("The most important thing is to start with a clear story.", firstIncomplete[1] + 1);
const nextIncomplete = findRange("The next part is");
const nextComplete = findRange("The next part is checking every cut by ear.", nextIncomplete[1] + 1);
const uniqueEarlier = findRange("Then you can add visual polish and a surprising statistic.");
const uniqueLater = findRange("Sorry, then you can add visual polish once the structure works.", uniqueEarlier[1] + 1);

export const sampleSemanticHints: SemanticHint[] = [
  {
    kind: "repetition",
    earlierWordRange: firstIncomplete,
    keptWordRange: firstComplete,
    confidence: 0.92,
    reason: "The opening phrase restarts immediately; the later take is complete.",
  },
  {
    kind: "retake",
    earlierWordRange: nextIncomplete,
    keptWordRange: nextComplete,
    confidence: 0.96,
    reason: "The first take stops mid-thought and is completed in the following take.",
  },
  {
    kind: "retake",
    earlierWordRange: uniqueEarlier,
    keptWordRange: uniqueLater,
    confidence: 0.72,
    reason: "The speaker restarts with similar wording, but the takes are not equivalent.",
    uniqueTerms: ["surprising statistic"],
  },
];

export const SAMPLE_DURATION = 33.4;
