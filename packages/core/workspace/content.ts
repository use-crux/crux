/**
 * Content analysis and file-record conversions.
 *
 * Turns raw {@link WorkspaceContent} into a {@link ContentAnalysis}, builds the
 * persisted {@link WorkspaceFileRecord} (inline or blob-backed), and converts
 * records into {@link WorkspaceFile} listing shapes.
 *
 * @module
 */

import type { JsonValue } from "../types/tool";
import type {
  WorkspaceArtifactStatus,
  WorkspaceProvenance,
} from "./artifact-types";
import {
  FILE_RECORD_VERSION,
  type ContentAnalysis,
  type WorkspaceBlobStore,
  type WorkspaceContent,
  type WorkspaceFile,
  type WorkspaceFileRecord,
  type WorkspacePath,
} from "./types";

/** Analyze raw content into its kind, mime type, size, and decoded payload. */
export async function analyzeContent(
  content: WorkspaceContent,
  mimeType?: string,
): Promise<ContentAnalysis> {
  if (typeof content === "string") {
    return {
      kind: "text",
      text: content,
      mimeType: mimeType ?? "text/plain",
      size: byteLength(content),
    };
  }
  if (content instanceof Uint8Array) {
    return {
      kind: "binary",
      binary: content,
      mimeType: mimeType ?? "application/octet-stream",
      size: content.byteLength,
    };
  }
  if (isBlob(content)) {
    return {
      kind: isTextMime(mimeType ?? content.type) ? "text" : "binary",
      binary: content,
      mimeType: (mimeType ?? content.type) || "application/octet-stream",
      size: content.size,
      text: isTextMime(mimeType ?? content.type)
        ? await content.text()
        : undefined,
    };
  }
  if (isReadableStream(content)) {
    return {
      kind: "binary",
      binary: content,
      mimeType: mimeType ?? "application/octet-stream",
      size: 0,
    };
  }
  const json = content as JsonValue;
  return {
    kind: "json",
    json,
    mimeType: "application/json",
    size: byteLength(JSON.stringify(json)),
  };
}

/** Build a persisted file record, inlining small text/JSON or writing to a blob store. */
export async function createFileRecord(input: {
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly mount: WorkspacePath;
  readonly analysis: ContentAnalysis;
  readonly metadata: Record<string, JsonValue> | undefined;
  readonly status: WorkspaceArtifactStatus | undefined;
  readonly artifactKind: string | undefined;
  readonly producedBy: WorkspaceProvenance | undefined;
  readonly existing: WorkspaceFileRecord | null;
  readonly now: number;
  /** The version number this record becomes; scopes the blob key so history is immutable. */
  readonly version: number;
  readonly inlineTextBelowBytes: number;
  readonly blobs: WorkspaceBlobStore | undefined;
}): Promise<WorkspaceFileRecord> {
  const status = input.status ?? input.existing?.status;
  const base = {
    _cruxWorkspaceFile: true as const,
    version: FILE_RECORD_VERSION as typeof FILE_RECORD_VERSION,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    mount: input.mount,
    mimeType: input.analysis.mimeType,
    size: input.analysis.size,
    metadata: input.metadata,
    status,
    kind: input.artifactKind ?? input.existing?.kind,
    producedBy: input.producedBy ?? input.existing?.producedBy,
    headVersion: input.version,
    finalVersion: pinnedFinalVersion(status, input.version, input.existing),
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };

  if (
    input.analysis.kind === "json" &&
    input.analysis.size <= input.inlineTextBelowBytes
  ) {
    return {
      ...base,
      storage: "inline",
      inlineJson: input.analysis.json,
      preview: preview(JSON.stringify(input.analysis.json)),
    };
  }

  if (
    input.analysis.kind === "text" &&
    input.analysis.text !== undefined &&
    input.analysis.size <= input.inlineTextBelowBytes
  ) {
    return {
      ...base,
      storage: "inline",
      inlineText: input.analysis.text,
      preview: preview(input.analysis.text),
    };
  }

  if (!input.blobs) {
    throw new Error(
      "workspace.write(): binary or oversized content requires a WorkspaceBlobStore.",
    );
  }

  const payload =
    input.analysis.kind === "text"
      ? (input.analysis.text ?? "")
      : input.analysis.kind === "json"
        ? JSON.stringify(input.analysis.json)
        : input.analysis.binary;
  if (payload === undefined) {
    throw new Error("workspace.write(): binary content could not be read.");
  }
  const ref = await input.blobs.put({
    key: `${input.workspaceId}/${input.namespace}${input.path}@v${input.version}`,
    content: payload,
    mimeType: input.analysis.mimeType,
    metadata: input.metadata,
  });
  return {
    ...base,
    storage: "blob",
    uri: ref.uri,
    size: ref.size || input.analysis.size,
    preview: input.analysis.text ? preview(input.analysis.text) : undefined,
  };
}

/**
 * Resolve the pinned published version for a record being written.
 *
 * A file that newly becomes `final` pins the version it was finalized at; a file
 * that stays `final` across a content edit keeps its existing pin (so the
 * published artifact does not move while the working copy advances); a non-final
 * file has no pin.
 */
function pinnedFinalVersion(
  status: WorkspaceArtifactStatus | undefined,
  version: number,
  existing: WorkspaceFileRecord | null,
): number | undefined {
  if (status !== "final") return undefined;
  if (existing?.status === "final" && existing.finalVersion !== undefined) {
    return existing.finalVersion;
  }
  return version;
}

/** Convert a stored record into a {@link WorkspaceFile} listing entry. */
export function recordToFile(record: WorkspaceFileRecord): WorkspaceFile {
  return {
    kind: "file",
    path: record.path,
    ...recordArtifactFields(record),
    mimeType: record.mimeType,
    size: record.size,
    mount: record.mount,
    storage: record.storage,
    ...(record.uri ? { uri: record.uri } : {}),
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Public artifact fields shared by listing/stat/read results. */
export function recordArtifactFields(record: WorkspaceFileRecord): {
  readonly status?: WorkspaceArtifactStatus;
  readonly artifactKind?: string;
  readonly producedBy?: WorkspaceFileRecord["producedBy"];
} {
  return {
    ...(record.status ? { status: record.status } : {}),
    ...(record.kind ? { artifactKind: record.kind } : {}),
    ...(record.producedBy ? { producedBy: record.producedBy } : {}),
  };
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof ReadableStream !== "undefined" && value instanceof ReadableStream
  );
}

function isTextMime(mimeType: string | undefined): boolean {
  return (
    !!mimeType &&
    (mimeType.startsWith("text/") || mimeType === "application/json")
  );
}

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function preview(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

/** Find all start indexes of `find` within `content`. */
export function findOccurrences(content: string, find: string): number[] {
  const indexes: number[] = [];
  let index = content.indexOf(find);
  while (index >= 0) {
    indexes.push(index);
    index = content.indexOf(find, index + find.length);
  }
  return indexes;
}
