export function shouldQueueAutomaticPreviewRefresh(
  renderedSignature: string | undefined,
  mediaId: string | undefined,
): boolean;

export function resolvePreviewRefreshAction(options: {
  renderedSignature: string | undefined;
  nextSignature: string;
  automaticRequested: boolean;
  mediaId: string | undefined;
}): "none" | "render" | "invalidate";
