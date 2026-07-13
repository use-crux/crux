/**
 * Helpers for materializing copied workspace files.
 *
 * @module
 */

import { analyzeContent, createFileRecord } from "./content";
import type { AssetStore } from "../storage";
import type {
  ContentAnalysis,
  WorkspaceContent,
  WorkspaceFileRecord,
  WorkspacePath,
  WorkspaceReadResult,
} from "./types";
import { byteLength } from "./text-utils";

/** Create a fresh stored file record from a source-backed read result. */
export async function createFileRecordFromReadResult(input: {
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly mount: WorkspacePath;
  readonly result: WorkspaceReadResult;
  readonly inlineTextBelowBytes: number;
  readonly assets: AssetStore | undefined;
}): Promise<WorkspaceFileRecord> {
  const analysis = await readResultToContentAnalysis(input.result);
  return createFileRecord({
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    mount: input.mount,
    analysis,
    metadata: input.result.metadata,
    status: input.result.status,
    artifactKind: input.result.artifactKind,
    producedBy: input.result.producedBy,
    existing: null,
    now: Date.now(),
    version: 1,
    inlineTextBelowBytes: input.inlineTextBelowBytes,
    assets: input.assets,
  });
}

async function readResultToContentAnalysis(
  result: WorkspaceReadResult,
): Promise<ContentAnalysis> {
  if (result.kind === "json") {
    return {
      kind: "json",
      json: result.content,
      mimeType: "application/json",
      size: byteLength(JSON.stringify(result.content)),
    };
  }
  return analyzeContent(readResultToWorkspaceContent(result), result.mimeType);
}

/** Convert readable virtual content into a value accepted by `Workspace.write()`. */
export function readResultToWorkspaceContent(
  result: WorkspaceReadResult,
): WorkspaceContent {
  if (result.kind === "text") return result.content;
  if (result.kind === "json") {
    return result.content as WorkspaceContent;
  }
  throw new Error(
    `workspace.copy(): copying binary source file "${result.path}" requires readable bytes.`,
  );
}
