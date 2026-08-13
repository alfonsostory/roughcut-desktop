import type { CutConfig, SemanticHint, WordTimestamp } from "./engine.mjs";

export function detectRetakeHints(
  words: WordTimestamp[],
  config?: Pick<CutConfig, "retakeWindow"> & { minimumRepeatedWords?: number },
): SemanticHint[];

export function mergeSemanticHints(
  explicitHints?: SemanticHint[],
  detectedHints?: SemanticHint[],
): SemanticHint[];
