export function shouldQueueAutomaticPreviewRefresh(renderedSignature, mediaId) {
  return Boolean(renderedSignature && mediaId);
}

export function resolvePreviewRefreshAction({
  renderedSignature,
  nextSignature,
  automaticRequested,
  mediaId,
}) {
  if (!renderedSignature || renderedSignature === nextSignature) return "none";
  return automaticRequested && mediaId ? "render" : "invalidate";
}
