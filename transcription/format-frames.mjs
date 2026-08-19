export const DEFAULT_FRAME_COUNT = 8;
export const MAX_FRAME_COUNT = 16;
export const FRAME_MAX_WIDTH = 512;

export function parseFfmpegDuration(stderrText) {
  const match = String(stderrText ?? "").match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function frameTimestamps(duration, count = DEFAULT_FRAME_COUNT) {
  const safeCount = Math.max(1, Math.min(MAX_FRAME_COUNT, Math.trunc(count) || DEFAULT_FRAME_COUNT));
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const usable = Math.max(0.05, duration - 0.1);
  if (safeCount === 1) return [Number((usable / 2).toFixed(3))];
  return Array.from({ length: safeCount }, (_, index) =>
    Number((0.05 + (usable - 0.05) * (index / (safeCount - 1))).toFixed(3)));
}

export function isImageUpload(fileName, contentType = "") {
  if (String(contentType).toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(fileName ?? ""));
}
