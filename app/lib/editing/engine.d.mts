export type CutStatus = "approved" | "rejected" | "needs_review";
export type CutType = "silence" | "retake" | "repetition" | "filler";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface SemanticHint {
  kind: "retake" | "repetition";
  earlierWordRange: [number, number];
  keptWordRange: [number, number];
  confidence: number;
  reason: string;
  uniqueTerms?: string[];
}

export interface CutConfig {
  longPauseThreshold: number;
  targetPause: number;
  minimumSpeechSide: number;
  speechSafetyPadding: number;
  minimumTransition: number;
  retakeWindow: number;
}

export interface CandidateCut {
  id: string;
  start: number;
  end: number;
  type: CutType;
  confidence: number;
  risk: "low" | "medium" | "high";
  reason: string;
  original_text: string;
  resulting_text: string;
  status: CutStatus;
  validation: { valid: boolean; issues: string[]; resultingGap: number };
  sourceWordRange: [number, number] | null;
  semanticHint?: { removedText: string; keptText: string; uniqueTerms: string[] };
  humanOverride?: boolean;
  audioVerified?: boolean;
  breathDetected?: boolean;
  evidence?: Array<Record<string, unknown>>;
}

export interface AudioSilence {
  start: number;
  end: number;
  duration: number;
  minimum_db?: number;
}

export interface AudioBreath {
  start: number;
  end: number;
  duration: number;
  confidence: number;
  mean_db?: number;
  evidence?: string;
}

export const DEFAULT_CONFIG: Readonly<CutConfig>;
export function validateCut(cut: { start: number; end: number }, words: WordTimestamp[], config?: CutConfig): CandidateCut["validation"];
export function generateCandidateCuts(
  words: WordTimestamp[],
  hints?: SemanticHint[],
  config?: Partial<CutConfig>,
  analysis?: {
    duration?: number;
    audioSilences?: AudioSilence[];
    audioBreaths?: AudioBreath[];
    silenceThresholdDb?: number;
  },
): CandidateCut[];
export function buildEdl(duration: number, candidates: CandidateCut[]): Array<{ start: number; end: number; action: "keep" | "remove"; candidateCutIds?: string[] }>;
export function validateEditedResult(words: WordTimestamp[], candidates: CandidateCut[], config?: CutConfig): {
  reconstructedTranscript: string;
  missingUniqueWords: string[];
  remainingLongPauses: Array<{ after: string; duration: number }>;
  dangerousCuts: string[];
  valid: boolean;
};
