import type { CaptionCue, OverlayPlan } from "./apply.mjs";
import type { FormatSpec } from "./spec.mjs";

export function srtTimestamp(secondsValue: number): string;
export function buildCaptionsSrt(cues: CaptionCue[]): string;
export function buildFormatGuide(spec: FormatSpec, plan: OverlayPlan, sourceName: string): string;
