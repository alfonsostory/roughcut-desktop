import type { SemanticHint, WordTimestamp } from "../editing/engine.mjs";

export interface TranscriptCorrection {
  word_index: number;
  original_text: string;
  corrected_text: string;
  confidence: number;
  reason: string;
  status: "applied" | "reverted";
}

export interface TranscriptPayload {
  duration?: number;
  language?: string;
  text?: string;
  words: WordTimestamp[];
  semantic_hints?: SemanticHint[];
  transcript_corrections?: Array<Partial<TranscriptCorrection>>;
  audio_analysis?: {
    frame_duration: number;
    silence_threshold_db: number;
    minimum_silence: number;
    silences: Array<{ start: number; end: number; duration: number; minimum_db: number }>;
    breaths?: Array<{
      start: number;
      end: number;
      duration: number;
      confidence: number;
      mean_db?: number;
      evidence?: string;
    }>;
    waveform_peaks?: number[];
    breath_detection?: {
      minimum_duration: number;
      minimum_word_gap: number;
      mode: string;
    };
  };
  transcription?: {
    engine?: string;
    model?: string;
    word_timestamps?: boolean;
  };
}

export interface NormalizedTranscriptPayload extends TranscriptPayload {
  duration: number;
  words: WordTimestamp[];
  semantic_hints: SemanticHint[];
  transcript_corrections: TranscriptCorrection[];
  opening_word: OpeningWordResult;
}

export interface OpeningWordResult {
  index: number;
  word: WordTimestamp;
  confidence: number | null;
  ignoredLeadingTokens: number;
  usedLowConfidenceFallback: boolean;
  audioAnchored?: boolean;
}

export function normalizeTranscriptPayload(payload: unknown): NormalizedTranscriptPayload;
export function findFirstRecognizableWord(words: WordTimestamp[], minimumConfidence?: number): OpeningWordResult;
