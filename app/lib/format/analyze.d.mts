import type { FormatSpec } from "./spec.mjs";

export interface InspirationFrame {
  base64?: string;
  dataUrl?: string;
  mimeType?: string;
  timestamp?: number;
}

export const OPENAI_RESPONSES_URL: string;
export const DEFAULT_FORMAT_MODEL: string;
export function buildFormatAnalysisRequest(input: {
  brief: string;
  frames: Array<InspirationFrame | string>;
  inspirationTranscript?: string | null;
  model?: string;
  maxOutputTokens?: number;
}): Record<string, unknown>;
export function parseFormatAnalysisResponse(payload: unknown): FormatSpec;
export function requestFormatAnalysis(
  request: Record<string, unknown>,
  options: { apiKey: string; fetchImpl?: typeof fetch },
): Promise<FormatSpec>;
