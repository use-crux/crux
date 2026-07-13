/**
 * Content analysis and file-record conversions.
 *
 * Turns raw {@link WorkspaceContent} into a {@link ContentAnalysis}, builds the
 * persisted {@link WorkspaceFileRecord} (inline or asset-backed), and converts
 * records into {@link WorkspaceFile} listing shapes.
 *
 * @module
 */

import type { JsonValue } from "../types/tool";
import type { AssetStore, ExactFilter } from "../storage";
import { boundedStreamBlob, workspaceDataAsset } from "./asset-content";
import type {
  WorkspaceArtifactStatus,
  WorkspaceProvenance,
} from "./artifact-types";
import {
  FILE_RECORD_VERSION,
  type ContentAnalysis,
  type WorkspaceContent,
  type WorkspaceFile,
  type WorkspaceFileRecord,
  type WorkspacePath,
} from "./types";
import { byteLength } from "./text-utils";

/** Analyze raw content into its kind, mime type, size, and decoded payload. */
export async function analyzeContent(
  content: WorkspaceContent,
  mimeType?: string,
  options: {
    readonly maxStreamBytes?: number;
    readonly path?: string;
  } = {},
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
    const finalMimeType = mimeType ?? "application/octet-stream";
    const asset = await boundedStreamBlob({
      stream: content,
      mediaType: finalMimeType,
      maxBytes: options.maxStreamBytes,
      path: options.path ?? "<unknown>",
    });
    return {
      kind: "binary",
      binary: asset,
      mimeType: finalMimeType,
      size: asset.size,
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

/** Build a persisted file record, inlining small text/JSON or writing to an asset store. */
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
  /** The version number this record becomes; scopes the asset key so history is immutable. */
  readonly version: number;
  readonly inlineTextBelowBytes: number;
  readonly assets: AssetStore | undefined;
}): Promise<WorkspaceFileRecord> {
  const status = input.status ?? input.existing?.status;
  const kind = input.artifactKind ?? input.existing?.kind;
  const producedBy = input.producedBy ?? input.existing?.producedBy;
  const finalVersion = pinnedFinalVersion(
    status,
    input.version,
    input.existing,
  );
  const base = {
    _cruxWorkspaceFile: true as const,
    version: FILE_RECORD_VERSION as typeof FILE_RECORD_VERSION,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    mount: input.mount,
    mimeType: input.analysis.mimeType,
    size: input.analysis.size,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(producedBy !== undefined ? { producedBy } : {}),
    headVersion: input.version,
    ...(finalVersion !== undefined ? { finalVersion } : {}),
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

  if (!input.assets) {
    throw new Error(
      "workspace.write(): binary or oversized content requires an AssetStore.",
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
  const stored = await input.assets.put(
    workspaceDataAsset({
      data: payload,
      mediaType: input.analysis.mimeType,
      size: input.analysis.size,
    }),
    {
      key: `${input.workspaceId}/${input.namespace}${input.path}@v${input.version}`,
      metadata: scalarMetadata(input.metadata),
    },
  );
  return {
    ...base,
    storage: "asset",
    assetRef: stored.ref,
    size: stored.size ?? input.analysis.size,
    ...(stored.sha256 !== undefined ? { sha256: stored.sha256 } : {}),
    ...(input.analysis.text ? { preview: preview(input.analysis.text) } : {}),
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
    ...(record.assetRef ? { uri: record.assetRef.uri } : {}),
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

function scalarMetadata(
  metadata: Record<string, JsonValue> | undefined,
): ExactFilter | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(([, value]) =>
    isExactFilterValue(value),
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as ExactFilter)
    : undefined;
}

function isExactFilterValue(
  value: JsonValue | undefined,
): value is ExactFilter[string] {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
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

function preview(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}
