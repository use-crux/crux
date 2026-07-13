/**
 * Workspace read-result hydration.
 *
 * Converts persisted file records into public read results, including
 * out-of-line asset hydration and byte-bounded text windows.
 *
 * @module
 */

import type { AssetStore } from "../storage";
import type { JsonValue } from "../types/tool";
import { dataAssetText, requireStoredDataAsset } from "./asset-content";
import { recordArtifactFields } from "./content";
import { workspaceTextByteWindow } from "./text-window";
import {
  DEFAULT_INLINE_TEXT_BYTES,
  type WorkspaceFileRecord,
  type WorkspaceReadResult,
} from "./types";

export interface RecordToReadResultOptions {
  /** Asset store used to hydrate records stored out-of-line. */
  readonly assets?: AssetStore;
  /** Maximum text bytes to return inline before windowing. */
  readonly maxInlineBytes?: number;
  /** Byte offset for text windowing. */
  readonly offset?: number;
}

/** Convert a stored record into a {@link WorkspaceReadResult}, hydrating assets when needed. */
export async function recordToReadResult(
  record: WorkspaceFileRecord,
  options: RecordToReadResultOptions = {},
): Promise<WorkspaceReadResult> {
  const maxInlineBytes = options.maxInlineBytes ?? DEFAULT_INLINE_TEXT_BYTES;

  if (record.storage === "inline" && record.inlineText !== undefined) {
    return textReadResult(
      record,
      record.inlineText,
      maxInlineBytes,
      options.offset,
    );
  }
  if (record.storage === "inline" && record.inlineJson !== undefined) {
    return {
      kind: "json",
      path: record.path,
      ...recordArtifactFields(record),
      mimeType: "application/json",
      content: record.inlineJson,
      size: record.size,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    };
  }
  if (record.storage === "asset") {
    if (!record.assetRef) {
      throw new Error(
        `workspace file "${record.path}" has asset storage but no ref.`,
      );
    }
    if (!options.assets) {
      throw new Error(
        `workspace.read(): asset-backed file "${record.path}" requires an AssetStore.`,
      );
    }
    const stored = requireStoredDataAsset(
      await options.assets.get(record.assetRef),
      record.path,
    );
    if (isTextMime(record.mimeType)) {
      const text = await dataAssetText(stored);
      if (record.mimeType === "application/json") {
        return {
          kind: "json",
          path: record.path,
          ...recordArtifactFields(record),
          mimeType: "application/json",
          content: JSON.parse(text) as JsonValue,
          size: record.size,
          ...(record.metadata ? { metadata: record.metadata } : {}),
        };
      }
      return textReadResult(record, text, maxInlineBytes, options.offset);
    }
    return binaryReference(record, stored);
  }
  return binaryReference(record);
}

function textReadResult(
  record: WorkspaceFileRecord,
  content: string,
  maxInlineBytes: number,
  offset: number | undefined,
): Extract<WorkspaceReadResult, { kind: "text" }> {
  const window = workspaceTextByteWindow(content, maxInlineBytes, offset);
  return {
    kind: "text",
    path: record.path,
    ...recordArtifactFields(record),
    mimeType: record.mimeType,
    content: window.content,
    size: record.size,
    ...(window.truncated ? { truncated: true } : {}),
    ...(window.offset > 0 ? { offset: window.offset } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function binaryReference(
  record: WorkspaceFileRecord,
  stored?: Extract<Awaited<ReturnType<AssetStore["get"]>>, { type: "data" }>,
): Extract<WorkspaceReadResult, { kind: "binary" }> {
  const uri = stored?.ref.uri ?? record.assetRef?.uri;
  if (!uri) {
    throw new Error(
      `workspace file "${record.path}" has asset storage but no ref.`,
    );
  }
  return {
    kind: "binary",
    path: record.path,
    ...recordArtifactFields(record),
    mimeType: stored?.mediaType ?? record.mimeType,
    uri,
    size: stored?.size ?? record.size,
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function isTextMime(mimeType: string | undefined): boolean {
  return (
    !!mimeType &&
    (mimeType.startsWith("text/") || mimeType === "application/json")
  );
}
