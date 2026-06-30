/**
 * Projection helpers from workspace read results to virtual file metadata.
 *
 * @module
 */

import type { WorkspaceFile, WorkspaceReadResult } from "./types";

/** Convert a read result into a virtual file entry owned by `mountPath`. */
export function virtualFileFromReadResult(
  result: WorkspaceReadResult,
  mountPath: string,
): WorkspaceFile {
  return {
    kind: "file",
    path: result.path,
    mount: mountPath,
    mimeType: result.mimeType,
    size: result.size,
    storage: "virtual",
    ...(result.status ? { status: result.status } : {}),
    ...(result.artifactKind ? { artifactKind: result.artifactKind } : {}),
    ...(result.producedBy ? { producedBy: result.producedBy } : {}),
    ...(result.metadata ? { metadata: result.metadata } : {}),
    ...(result.kind === "binary" && result.uri ? { uri: result.uri } : {}),
    ...(result.kind === "binary" && result.preview
      ? { preview: result.preview }
      : {}),
    createdAt: 0,
    updatedAt: 0,
  };
}
