import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const seconds = (value) => Number(value.toFixed(3));

export function normalizeKeepRanges(ranges, duration = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(ranges)) throw new Error("Keep ranges are required.");
  const normalized = ranges
    .map((range) => ({ start: Number(range.start), end: Number(range.end) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .map((range) => ({ start: Math.max(0, range.start), end: Math.min(duration, range.end) }))
    .filter((range) => range.end - range.start >= 0.01)
    .sort((left, right) => left.start - right.start);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].start < normalized[index - 1].end - 0.001) {
      throw new Error("Keep ranges must not overlap.");
    }
  }
  if (!normalized.length) throw new Error("No valid keep ranges were supplied.");
  return normalized.map((range) => ({ start: seconds(range.start), end: seconds(range.end) }));
}

export function segmentFileName(index, range) {
  const label = String(index + 1).padStart(3, "0");
  const start = range.start.toFixed(3).replace(".", "-");
  const end = range.end.toFixed(3).replace(".", "-");
  return `${label}__${start}s-${end}s.mp4`;
}

export function buildSegmentManifest(sourceName, ranges) {
  let timelineCursor = 0;
  return {
    version: "roughcut-segments/0.1",
    source: sourceName,
    import_order: "ascending_filename",
    capcut_note: "Import every numbered MP4, sort by filename, select all, then drag them to the main track.",
    segments: ranges.map((range, index) => {
      const duration = seconds(range.end - range.start);
      const segment = {
        order: index + 1,
        file: segmentFileName(index, range),
        source_start: range.start,
        source_end: range.end,
        duration,
        timeline_start: seconds(timelineCursor),
        timeline_end: seconds(timelineCursor + duration),
      };
      timelineCursor += duration;
      return segment;
    }),
  };
}

export async function writePackageGuides(directory, sourceName, ranges) {
  await mkdir(directory, { recursive: true });
  const manifest = buildSegmentManifest(sourceName, ranges);
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(directory, "CAPCUT_IMPORT.txt"),
    [
      "ROUGH CUT — CAPCUT IMPORT",
      "",
      "1. Create or open a CapCut Desktop project.",
      "2. Import all numbered MP4 files from this folder.",
      "3. Sort the media bin by Name (ascending).",
      "4. Select every numbered clip and drag them together to the main timeline.",
      "5. Verify that clip 001 is first and the numbering remains sequential.",
      "",
      "CapCut currently does not support importing third-party EDL/XML project timelines.",
      "The zero-padded filenames preserve the intended order for the supported media-import workflow.",
      "",
      `Source: ${sourceName}`,
      `Segments: ${ranges.length}`,
    ].join("\n"),
  );
  return manifest;
}
