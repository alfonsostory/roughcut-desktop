import type { SemanticHint, WordTimestamp } from "../editing/engine.mjs";
import type { TranscriptCorrection } from "./normalize.mjs";

export interface SupportingScriptAnalysis {
  corrections: TranscriptCorrection[];
  correctedWords: WordTimestamp[];
  semanticHints: SemanticHint[];
  scriptWordCount: number;
  matchedWordCount: number;
}

export function normalizeToken(value: unknown): string;
export function lexicalTokens(text: unknown): string[];
export function tokenSimilarity(left: unknown, right: unknown): number;
export function findScriptAssistedCorrections(words: WordTimestamp[], script: string): TranscriptCorrection[];
export function applyTranscriptCorrections(words: WordTimestamp[], corrections?: TranscriptCorrection[]): WordTimestamp[];
export function detectScriptRetakeHints(
  words: WordTimestamp[],
  script: string,
  options?: { retakeWindow?: number },
): SemanticHint[];
export function analyzeSupportingScript(
  words: WordTimestamp[],
  script: string,
  options?: { retakeWindow?: number },
): SupportingScriptAnalysis;
