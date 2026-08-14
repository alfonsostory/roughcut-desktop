import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePreviewRefreshAction,
  shouldQueueAutomaticPreviewRefresh,
} from "../app/lib/editing/preview.mjs";

test("a decision change queues automatic rendering only after a preview exists", () => {
  assert.equal(shouldQueueAutomaticPreviewRefresh("old-edl", "media-1"), true);
  assert.equal(shouldQueueAutomaticPreviewRefresh(undefined, "media-1"), false);
  assert.equal(shouldQueueAutomaticPreviewRefresh("old-edl", undefined), false);
});

test("a changed EDL automatically renders when a refresh was requested", () => {
  assert.equal(resolvePreviewRefreshAction({
    renderedSignature: "old-edl",
    nextSignature: "new-edl",
    automaticRequested: true,
    mediaId: "media-1",
  }), "render");
});

test("unchanged or unrenderable previews do not start a stale automatic render", () => {
  assert.equal(resolvePreviewRefreshAction({
    renderedSignature: "same-edl",
    nextSignature: "same-edl",
    automaticRequested: true,
    mediaId: "media-1",
  }), "none");
  assert.equal(resolvePreviewRefreshAction({
    renderedSignature: "old-edl",
    nextSignature: "new-edl",
    automaticRequested: true,
    mediaId: undefined,
  }), "invalidate");
});
