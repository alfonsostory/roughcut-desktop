import type { CandidateCut, WordTimestamp } from "./engine.mjs";

export function getRemovedWordIndexes(words: WordTimestamp[], candidates: CandidateCut[]): Set<number>;
export function reconstructParagraphTranscript(words: WordTimestamp[], candidates: CandidateCut[]): string;
