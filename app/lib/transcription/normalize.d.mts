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
