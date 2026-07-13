/**
 * Hydrate a stored version snapshot back into usable content.
 *
 * `undo` re-writes a previous revision, and `diff` reads two revisions as text;
 * both need a snapshot's bytes/text/JSON, inline or out-of-line. These helpers
 * keep that hydration out of the version-operation orchestration.
 *
 * @module
 */

import { recordToReadResult } from "./read-result";
import { dataAssetBytes, requireStoredDataAsset } from "./asset-content";
import type { AssetStore } from "../storage";
import type {
  WorkspaceContent,
  WorkspaceFileRecord,
  WorkspaceJsonContent,
} from "./types";

/**
 * Load a snapshot's content in a form accepted by `write`, for restoring it.
 *
 * Text and JSON round-trip as themselves; binary is returned as bytes so the
 * restore re-stores it under a fresh version-scoped asset key.
 */
export async function snapshotContent(
  record: WorkspaceFileRecord,
  assets: AssetStore | undefined,
): Promise<WorkspaceContent> {
  if (record.storage === "inline" && record.inlineText !== undefined) {
    return record.inlineText;
  }
  if (record.storage === "inline" && record.inlineJson !== undefined) {
    return record.inlineJson as WorkspaceJsonContent;
  }
  const read = await recordToReadResult(record, {
    assets,
    maxInlineBytes: Number.MAX_SAFE_INTEGER,
  });
  if (read.kind === "text") return read.content;
  if (read.kind === "json") return read.content as WorkspaceJsonContent;
  if (!assets) {
    throw new Error(
      `workspace.undo(): restoring "${record.path}" requires an AssetStore.`,
    );
  }
  const asset = requireStoredDataAsset(
    await assets.get({ uri: read.uri }),
    record.path,
  );
  return dataAssetBytes(asset);
}

/**
 * Load a snapshot's content as diffable text. JSON is pretty-printed; binary
 * throws, since there is no meaningful line diff for it.
 */
export async function snapshotText(
  record: WorkspaceFileRecord,
  assets: AssetStore | undefined,
): Promise<string> {
  const read = await recordToReadResult(record, {
    assets,
    maxInlineBytes: Number.MAX_SAFE_INTEGER,
  });
  if (read.kind === "text") return read.content;
  if (read.kind === "json") return `${JSON.stringify(read.content, null, 2)}\n`;
  throw new Error(
    `workspace.diff(): only text files can be diffed. "${record.path}" is binary.`,
  );
}
