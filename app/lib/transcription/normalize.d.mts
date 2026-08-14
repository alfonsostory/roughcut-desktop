import type { SemanticHint, WordTimestamp } from "../editing/engine.mjs";

export interface TranscriptPayload {
  duration?: number;
  language?: string;
  text?: string;
  words: WordTimestamp[];
  semantic_hints?: SemanticHint[];
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
}

export function normalizeTranscriptPayload(payload: unknown): NormalizedTranscriptPayload;
