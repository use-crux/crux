import { createHash } from "node:crypto";
import type {
  ProjectIndexManifestContentV1,
  ProjectIndexManifestId,
} from "@use-crux/core/project-index";

/** Serialize JSON-compatible data with recursively sorted object keys. @internal */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** Derive the content-addressed ID for canonical manifest content. @internal */
export function manifestIdForContent(
  content: ProjectIndexManifestContentV1,
): ProjectIndexManifestId {
  return `pim_${canonicalSha256Hex(content)}`;
}

/** Hash recursively canonicalized JSON as lowercase SHA-256. @internal */
export function canonicalSha256Hex(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

/** Compare strings by their UTF-8 bytes rather than locale or host settings. @internal */
export function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
