import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCaptionsSrt, buildFormatGuide } from "../app/lib/format/guide.mjs";
import { normalizeFormatSpec } from "../app/lib/format/spec.mjs";

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

export function buildFormatPackage(format) {
  if (!format || typeof format !== "object") return null;
  const spec = normalizeFormatSpec(format.spec);
  const plan = format.plan && typeof format.plan === "object" ? format.plan : null;
  if (!plan || !Array.isArray(plan.titles) || !Array.isArray(plan.captions)) {
    throw new Error("A format export needs the overlay plan computed from the reviewed edit.");
  }
  return {
    spec,
    plan,
    files: {
      spec_file: "format-spec.json",
      overlay_plan_file: "overlay-plan.json",
      captions_file: "captions.srt",
      guide_file: "CAPCUT_FORMAT_GUIDE.txt",
    },
  };
}

export async function writePackageGuides(directory, sourceName, ranges, format = null) {
  await mkdir(directory, { recursive: true });
  const formatPackage = buildFormatPackage(format);
  const manifest = buildSegmentManifest(sourceName, ranges);
  if (formatPackage) manifest.format = formatPackage.files;
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (formatPackage) {
    await writeFile(
      path.join(directory, formatPackage.files.spec_file),
      `${JSON.stringify(formatPackage.spec, null, 2)}\n`,
    );
    await writeFile(
      path.join(directory, formatPackage.files.overlay_plan_file),
      `${JSON.stringify(formatPackage.plan, null, 2)}\n`,
    );
    await writeFile(
      path.join(directory, formatPackage.files.captions_file),
      buildCaptionsSrt(formatPackage.plan.captions),
    );
    await writeFile(
      path.join(directory, formatPackage.files.guide_file),
      buildFormatGuide(formatPackage.spec, formatPackage.plan, sourceName),
    );
  }
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
