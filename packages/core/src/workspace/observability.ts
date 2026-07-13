/**
 * Instrumentation for workspace operations.
 *
 * Wraps each operation in an {@link observe} span, emits an output artifact with
 * a redacted preview (file contents are never stored), and forwards a structured
 * event to the runtime's instrumentation hooks.
 *
 * @module
 */

import { observe } from "../observability";
import { workspaceDefinitionRef } from "../observability/definition-ref";
import type { WorkspaceProvenance } from "./artifact-types";
import type { WorkspaceOperation } from "./types";
import type { WorkspaceVersionOperation } from "./version-types";

interface WorkspaceEvent {
  readonly workspaceId: string;
  readonly operation: WorkspaceOperation;
  readonly namespace: string;
  readonly path: string;
}

/**
 * Emit a privacy-safe marker for a newly recorded file version.
 *
 * Devtools reconstruct a file's history from these markers rather than from
 * operation spans: `edit`/`undo` wrap a nested `write` span, so counting
 * operation spans would double-count, whereas this fires exactly once per
 * version from the single persistence chokepoint — carrying the version number
 * and its true operation label, never the raw path or content.
 */
export function emitWorkspaceVersion(event: {
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string;
  readonly version: number;
  readonly operation: WorkspaceVersionOperation;
}): void {
  const attributes = {
    primitive: "workspace.operation",
    workspaceId: event.workspaceId,
    operation: event.operation,
    namespaceHash: hashString(event.namespace),
    pathHash: hashString(event.path),
    version: event.version,
  };
  // The span name (never a real operation) plus the numeric `version` attribute
  // let the devtools read model pick markers out of the workspace family.
  const span = observe.openSpan({
    name: "workspace.version",
    primitive: "workspace.operation",
    // `workspace()` requires `id`, so `workspaceId` is always the authored id.
    definitionRefs: [workspaceDefinitionRef(event.workspaceId)],
    attributes,
  });
  span.end({ attributes: { ...attributes, status: "success" } });
}

/** Capture artifact provenance from an already-active caller run/span. */
export function activeWorkspaceProvenance(): WorkspaceProvenance | undefined {
  const context = observe.captureContext();
  if (!context) return undefined;
  return {
    runId: context.runId,
    ...(context.currentSpanId ? { spanId: context.currentSpanId } : {}),
  };
}

/** Run a workspace operation inside a span, emitting artifacts, hooks, and timings. */
export async function instrument<T>(
  event: WorkspaceEvent,
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const span = observe.openSpan({
    name: `workspace.${event.operation}`,
    primitive: "workspace.operation",
    definitionRefs: [workspaceDefinitionRef(event.workspaceId)],
    attributes: {
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
    },
  });
  try {
    const result = await span.withContext(run);
    span.withContext(() => emitWorkspaceArtifact(span.spanId, event, result));
    const resultAttributes = workspaceResultAttributes(result);
    span.end({
      attributes: {
        primitive: "workspace.operation",
        workspaceId: event.workspaceId,
        operation: event.operation,
        namespaceHash: hashString(event.namespace),
        pathHash: hashString(event.path),
        status: "success",
        ...resultAttributes,
      },
    });
    return result;
  } catch (error) {
    span.error(error, {
      primitive: "workspace.operation",
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
      status: "error",
    });
    throw error;
  }
}

function emitWorkspaceArtifact(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  event: WorkspaceEvent,
  result: unknown,
): void {
  const preview = workspaceResultPreview(result, event);
  if (preview === undefined) return;
  const artifactId = observe.artifact({
    kind: "output",
    contentType: "application/json",
    encoding: "json",
    preview,
    attributes: {
      primitive: "workspace.operation",
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
      ...workspaceResultAttributes(result),
    },
  });
  if (!artifactId) return;
  observe.edge({
    edgeType: "produced",
    from: { kind: "span", id: spanId },
    to: { kind: "artifact", id: artifactId },
    attributes: {
      primitive: "workspace.operation",
      operation: event.operation,
      workspaceId: event.workspaceId,
    },
  });
}

function workspaceResultPreview(
  result: unknown,
  event: WorkspaceEvent,
): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.entries)) {
    return {
      resultKind: "list",
      entryCount: record.entries.length,
      entries: record.entries
        .slice(0, 50)
        .map((entry) => workspaceEntryPreview(entry)),
    };
  }
  if (record.kind === "file") {
    return {
      resultKind: "file",
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      storage: record.storage,
      metadata: record.metadata,
    };
  }
  if (
    record.kind === "text" ||
    record.kind === "json" ||
    record.kind === "binary"
  ) {
    return {
      resultKind: record.kind,
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      metadata: record.metadata,
      preview:
        typeof record.preview === "string"
          ? record.preview.slice(0, 500)
          : undefined,
      contentStored: false,
    };
  }
  if (isWorkspaceArtifactRecord(record)) {
    return {
      resultKind: "artifact",
      pathHash: hashString(event.path),
      mimeType: record.mimeType,
      size: record.size,
      status: record.status,
      artifactKind: record.kind,
      assetRef: opaqueRefDescriptor(record.assetRef),
      metadata: record.metadata,
      contentStored: false,
    };
  }
  return undefined;
}

function workspaceEntryPreview(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== "object") return { kind: "unknown" };
  const record = entry as Record<string, unknown>;
  return {
    kind: record.kind,
    path: record.path,
    mimeType: record.mimeType,
    size: record.size,
    storage: record.storage,
  };
}

function workspaceResultAttributes(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.entries))
    return { resultKind: "list", entryCount: record.entries.length };
  if (isWorkspaceArtifactRecord(record)) {
    return {
      resultKind: "artifact",
      artifactStatus: record.status,
      ...(typeof record.kind === "string" ? { artifactKind: record.kind } : {}),
      mimeType: record.mimeType,
      size: record.size,
      ...(typeof record.uri === "string" ? { assetRef: "present" } : {}),
    };
  }
  if (typeof record.kind === "string") {
    return {
      resultKind: record.kind,
      ...(typeof record.mimeType === "string"
        ? { mimeType: record.mimeType }
        : {}),
      ...(typeof record.size === "number" ? { size: record.size } : {}),
      ...(typeof record.storage === "string"
        ? { storage: record.storage }
        : {}),
      ...(typeof record.status === "string"
        ? { artifactStatus: record.status }
        : {}),
      ...(typeof record.artifactKind === "string"
        ? { artifactKind: record.artifactKind }
        : {}),
      ...(typeof record.uri === "string" ? { assetRef: "present" } : {}),
    };
  }
  return {};
}

/** True for the public WorkspaceArtifact projection returned by `finalize()` and `artifacts()`. */
function isWorkspaceArtifactRecord(
  record: Record<string, unknown>,
): record is Record<string, unknown> & {
  readonly path: string;
  readonly status: string;
  readonly mimeType: string;
  readonly size: number;
} {
  return (
    typeof record.path === "string" &&
    typeof record.status === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number" &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number" &&
    record.kind !== "file"
  );
}

function opaqueRefDescriptor(value: unknown): "present" | undefined {
  if (!value || typeof value !== "object") return undefined;
  const uri = (value as { readonly uri?: unknown }).uri;
  return typeof uri === "string" ? "present" : undefined;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
