import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSegmentManifest,
  normalizeKeepRanges,
  segmentFileName,
} from "../transcription/export-package.mjs";

test("segment exports are ordered and zero-padded for CapCut media import", () => {
  const ranges = normalizeKeepRanges([
    { start: 4.25, end: 8.5 },
    { start: 0, end: 2.125 },
  ], 10);
  assert.deepEqual(ranges, [
    { start: 0, end: 2.125 },
    { start: 4.25, end: 8.5 },
  ]);
  assert.equal(segmentFileName(0, ranges[0]), "001__0-000s-2-125s.mp4");
  assert.equal(segmentFileName(1, ranges[1]), "002__4-250s-8-500s.mp4");
});

test("segment manifest maps source ranges onto a contiguous output timeline", () => {
  const ranges = [{ start: 1, end: 2.5 }, { start: 4, end: 5 }];
  const manifest = buildSegmentManifest("source.mov", ranges);
  assert.equal(manifest.import_order, "ascending_filename");
  assert.deepEqual(manifest.segments.map((segment) => ({
    order: segment.order,
    timeline_start: segment.timeline_start,
    timeline_end: segment.timeline_end,
  })), [
    { order: 1, timeline_start: 0, timeline_end: 1.5 },
    { order: 2, timeline_start: 1.5, timeline_end: 2.5 },
  ]);
});

test("overlapping keep ranges are rejected", () => {
  assert.throws(() => normalizeKeepRanges([
    { start: 0, end: 2 },
    { start: 1.5, end: 3 },
  ]), /must not overlap/);
});
