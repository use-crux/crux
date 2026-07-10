/**
 * Workspace read-result hydration.
 *
 * Converts persisted file records into public read results, including
 * out-of-line text/blob hydration and byte-bounded text windows.
 *
 * @module
 */

import type { BlobContent } from "../storage";
import type { JsonValue } from "../types/tool";
import { recordArtifactFields } from "./content";
import { workspaceTextByteWindow } from "./text-window";
import {
  DEFAULT_INLINE_TEXT_BYTES,
  type WorkspaceBlobStore,
  type WorkspaceFileRecord,
  type WorkspaceReadResult,
} from "./types";

export interface RecordToReadResultOptions {
  /** Blob store used to hydrate text and JSON records stored out-of-line. */
  readonly blobs?: WorkspaceBlobStore;
  /** Maximum text bytes to return inline before windowing. */
  readonly maxInlineBytes?: number;
  /** Byte offset for text windowing. */
  readonly offset?: number;
}

/** Convert a stored record into a {@link WorkspaceReadResult}, hydrating textual blobs when needed. */
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
  if (record.storage === "blob" && isTextMime(record.mimeType)) {
    if (!record.uri) {
      throw new Error(
        `workspace file "${record.path}" has blob storage but no URI.`,
      );
    }
    if (!options.blobs) {
      throw new Error(
        `workspace.read(): text blob "${record.path}" requires a WorkspaceBlobStore.`,
      );
    }
    const blob = await options.blobs.get(record.uri);
    const text = await blobContentToText(blob.content);
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

async function blobContentToText(content: BlobContent): Promise<string> {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (isBlob(content)) return content.text();

  const reader = content.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      chunks.push(read.value);
      totalLength += read.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function binaryReference(
  record: WorkspaceFileRecord,
): Extract<WorkspaceReadResult, { kind: "binary" }> {
  if (!record.uri) {
    throw new Error(
      `workspace file "${record.path}" has blob storage but no URI.`,
    );
  }
  return {
    kind: "binary",
    path: record.path,
    ...recordArtifactFields(record),
    mimeType: record.mimeType,
    uri: record.uri,
    size: record.size,
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isTextMime(mimeType: string | undefined): boolean {
  return (
    !!mimeType &&
    (mimeType.startsWith("text/") || mimeType === "application/json")
  );
}
