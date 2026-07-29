import type { PromptPreviewBrowserErrorCode } from "./types";

/** Return whether a runtime failure may reflect a changed discovery tuple. */
export function shouldRefreshPromptPreviewDiscovery(
  code: PromptPreviewBrowserErrorCode,
): boolean {
  return (
    code === "no_peer" ||
    code === "environment_unavailable" ||
    code === "capability_unavailable" ||
    code === "target_unavailable" ||
    code === "catalogue_changed" ||
    code === "peer_disconnected" ||
    code === "target_disappeared"
  );
}
