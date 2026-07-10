/**
 * Runtime adapters for workspace mount sources.
 *
 * @module
 */

import { retrieverWorkspaceMountSource } from "./retriever-source";
import type {
  WorkspaceCustomMountSource,
  WorkspaceMountSource,
} from "./types";

/** Lower any public mount source variant to the executable custom source contract. */
export function workspaceMountSourceToCustomSource(
  source: WorkspaceMountSource,
): WorkspaceCustomMountSource {
  switch (source.kind) {
    case "custom":
      return source;
    case "retriever":
      return retrieverWorkspaceMountSource(source.retriever, {
        query: source.query,
        limit: source.limit,
        pathForHit: source.pathForHit,
        contentForHit: source.contentForHit,
        mimeType: source.mimeType,
      });
  }
}
