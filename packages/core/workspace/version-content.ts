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
import type {
  WorkspaceBlobStore,
  WorkspaceContent,
  WorkspaceFileRecord,
  WorkspaceJsonContent,
} from "./types";

/**
 * Load a snapshot's content in a form accepted by `write`, for restoring it.
 *
 * Text and JSON round-trip as themselves; binary is returned as bytes so the
 * restore re-stores it under a fresh version-scoped blob key.
 */
export async function snapshotContent(
  record: WorkspaceFileRecord,
  blobs: WorkspaceBlobStore | undefined,
): Promise<WorkspaceContent> {
  if (record.storage === "inline" && record.inlineText !== undefined) {
    return record.inlineText;
  }
  if (record.storage === "inline" && record.inlineJson !== undefined) {
    return record.inlineJson as WorkspaceJsonContent;
  }
  const read = await recordToReadResult(record, {
    blobs,
    maxInlineBytes: Number.MAX_SAFE_INTEGER,
  });
  if (read.kind === "text") return read.content;
  if (read.kind === "json") return read.content as WorkspaceJsonContent;
  if (!blobs) {
    throw new Error(
      `workspace.undo(): restoring "${record.path}" requires a WorkspaceBlobStore.`,
    );
  }
  const blob = await blobs.get(read.uri);
  return blobContentToBytes(blob.content);
}

/**
 * Load a snapshot's content as diffable text. JSON is pretty-printed; binary
 * throws, since there is no meaningful line diff for it.
 */
export async function snapshotText(
  record: WorkspaceFileRecord,
  blobs: WorkspaceBlobStore | undefined,
): Promise<string> {
  const read = await recordToReadResult(record, {
    blobs,
    maxInlineBytes: Number.MAX_SAFE_INTEGER,
  });
  if (read.kind === "text") return read.content;
  if (read.kind === "json") return `${JSON.stringify(read.content, null, 2)}\n`;
  throw new Error(
    `workspace.diff(): only text files can be diffed. "${record.path}" is binary.`,
  );
}

/** Read any {@link BlobContent} into a byte array, for re-writing a restored binary. */
async function blobContentToBytes(
  content: Awaited<ReturnType<WorkspaceBlobStore["get"]>>["content"],
): Promise<Uint8Array> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (typeof Blob !== "undefined" && content instanceof Blob) {
    return new Uint8Array(await content.arrayBuffer());
  }
  const reader = (content as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      chunks.push(read.value);
      total += read.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
