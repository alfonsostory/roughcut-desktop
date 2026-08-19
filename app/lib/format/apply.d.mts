import type { WordTimestamp } from "../editing/engine.mjs";
import type { FormatBrollSlot, FormatSpec, FormatTextOverlay } from "./spec.mjs";

export interface TimelineWord {
  index: number;
  word: string;
  source_start: number;
  source_end: number;
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface PlannedTitle {
  role: FormatTextOverlay["role"];
  item: number | null;
  text: string;
  start: number | null;
  end: number | null;
  placement: FormatTextOverlay["placement"];
  box: FormatTextOverlay["box"];
  font: FormatTextOverlay["font"];
  lines_max: number;
}

export interface PlannedBrollSlot extends FormatBrollSlot {
  item: number | null;
  start: number | null;
  end: number | null;
}

export interface ListItemSpan {
  item: number;
  title: string;
  found: boolean;
  word_start: number | null;
  word_end: number | null;
  start: number | null;
  end: number | null;
}

export interface OverlayPlan {
  version: string;
  duration: number;
  titles: PlannedTitle[];
  captions: CaptionCue[];
  broll: PlannedBrollSlot[];
  audio: FormatSpec["audio"];
  warnings: string[];
}

export const OVERLAY_PLAN_VERSION: string;
export function buildTimelineWords(
  words: WordTimestamp[],
  keepRanges: Array<{ start: number; end: number }>,
): TimelineWord[];
export function timelineDuration(keepRanges: Array<{ start: number; end: number }>): number;
export function chunkCaptionCues(
  timelineWords: TimelineWord[],
  options?: { maxWords?: number; maxGapSeconds?: number },
): CaptionCue[];
export function styleCaptionText(
  text: string,
  options?: { textCase?: string; keywordQuotes?: string[]; punctuation?: string },
): string;
export function locateListItemSpans(
  timelineWords: TimelineWord[],
  itemTitles: string[],
  options?: { minCoverage?: number },
): ListItemSpan[];
export function planFormatOverlays(input: {
  spec: FormatSpec;
  words: WordTimestamp[];
  keepRanges: Array<{ start: number; end: number }>;
}): OverlayPlan;
