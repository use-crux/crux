/** Shared scalar/descriptor helpers for media run projection. */

import type {
  SafeRunMediaDescriptor,
  SafeRunMediaSourceCategory,
} from "./media-run-projection-types";

const SAFE_SOURCE_CATEGORIES = new Set<string>([
  "data",
  "url",
  "provider-file",
  "asset-ref",
  "bytes",
  "blob",
  "unknown",
]);

/** Map inbound sourceCategory tokens to the canonical observability allowlist. */
export function normalizeSourceCategory(
  value: unknown,
): SafeRunMediaSourceCategory {
  if (value === "data-url") return "data";
  if (typeof value === "string" && SAFE_SOURCE_CATEGORIES.has(value)) {
    return value as SafeRunMediaSourceCategory;
  }
  return "unknown";
}

export function collectDescriptors(
  artifacts: readonly Readonly<{ preview?: unknown }>[],
): readonly SafeRunMediaDescriptor[] {
  const out: SafeRunMediaDescriptor[] = [];
  for (const artifact of artifacts) {
    walkDescriptors(artifact.preview, out);
  }
  return Object.freeze(out);
}

export function executionValue(
  value: unknown,
): "native" | "composed" | "unknown" | undefined {
  return value === "native" || value === "composed" || value === "unknown"
    ? value
    : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function walkDescriptors(
  value: unknown,
  out: SafeRunMediaDescriptor[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) walkDescriptors(item, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (isDescriptor(record)) {
    out.push(
      Object.freeze({
        kind: record.kind,
        ...(stringValue(record.mediaType)
          ? { mediaType: stringValue(record.mediaType) }
          : {}),
        ...(numberValue(record.sizeBytes) !== undefined
          ? { sizeBytes: numberValue(record.sizeBytes) }
          : {}),
        ...(numberValue(record.width) !== undefined
          ? { width: numberValue(record.width) }
          : {}),
        ...(numberValue(record.height) !== undefined
          ? { height: numberValue(record.height) }
          : {}),
        ...(numberValue(record.durationSeconds) !== undefined
          ? { durationSeconds: numberValue(record.durationSeconds) }
          : {}),
        ...(numberValue(record.pageCount) !== undefined
          ? { pageCount: numberValue(record.pageCount) }
          : {}),
        ...(stringValue(record.digestPrefix)
          ? { digestPrefix: stringValue(record.digestPrefix) }
          : {}),
        sourceCategory: normalizeSourceCategory(record.sourceCategory),
      }),
    );
    return;
  }
  for (const child of Object.values(record)) walkDescriptors(child, out);
}

function isDescriptor(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  kind: SafeRunMediaDescriptor["kind"];
  sourceCategory: unknown;
} {
  return (
    (value.kind === "image" ||
      value.kind === "audio" ||
      value.kind === "video" ||
      value.kind === "file") &&
    "sourceCategory" in value &&
    !("source" in value) &&
    !("url" in value) &&
    !("fileId" in value) &&
    !("data" in value)
  );
}
