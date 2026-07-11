import { sha256Hex } from "../content/sha256";

const MAX_DESCRIPTOR_HASH_BYTES = 256 * 1024;
const MIME_ESSENCE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export type MediaKind = "image" | "audio" | "video" | "file";

type SourceCategory =
  | "asset-ref"
  | "blob"
  | "bytes"
  | "data"
  | "data-url"
  | "provider-file"
  | "unknown"
  | "url";

export type SafeMediaDescriptor = Readonly<{
  kind: MediaKind;
  mediaType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  pageCount?: number;
  digestPrefix?: string;
  sourceCategory: SourceCategory;
}>;

/** Project a media part or asset into bounded, non-sensitive facts. */
export function mediaDescriptor(
  kind: MediaKind,
  source: unknown,
  facts: Record<string, unknown>,
): SafeMediaDescriptor {
  const sourceFacts = isRecord(source) ? source : undefined;
  const mediaType =
    safeMediaType(facts.mediaType) ??
    safeMediaType(sourceFacts?.mediaType) ??
    blobMediaType(source);
  const data = sourceFacts?.type === "data" ? sourceFacts.data : source;
  const bytes = byteView(data);
  const blob = isBlob(data) ? data : undefined;
  const knownSize =
    safeInteger(facts.size) ??
    safeInteger(sourceFacts?.size) ??
    bytes?.byteLength ??
    blob?.size;
  const digest =
    digestPrefix(facts.sha256) ??
    digestPrefix(sourceFacts?.sha256) ??
    (bytes ? digestBytes(bytes) : undefined);
  return Object.freeze({
    kind,
    ...(mediaType ? { mediaType } : {}),
    ...(knownSize !== undefined ? { sizeBytes: knownSize } : {}),
    ...optionalFact("width", facts.width ?? sourceFacts?.width),
    ...optionalFact("height", facts.height ?? sourceFacts?.height),
    ...optionalFact(
      "durationSeconds",
      facts.durationInSeconds ?? sourceFacts?.durationInSeconds,
    ),
    ...optionalFact("pageCount", facts.pageCount ?? sourceFacts?.pageCount),
    ...(digest ? { digestPrefix: digest } : {}),
    sourceCategory: sourceCategory(source),
  });
}

/** Project raw bytes into bounded, non-sensitive facts. */
export function bytesDescriptor(
  kind: MediaKind,
  bytes: Uint8Array,
): SafeMediaDescriptor {
  const digest = digestBytes(bytes);
  return Object.freeze({
    kind,
    sizeBytes: bytes.byteLength,
    ...(digest ? { digestPrefix: digest } : {}),
    sourceCategory: "bytes",
  });
}

/** Project a Blob into bounded, non-sensitive facts. */
export function blobDescriptor(
  kind: MediaKind,
  blob: Blob,
): SafeMediaDescriptor {
  const mediaType = safeMediaType(blob.type);
  return Object.freeze({
    kind,
    ...(mediaType ? { mediaType } : {}),
    sizeBytes: blob.size,
    sourceCategory: "blob",
  });
}

/** Infer a semantic media kind from a MIME type. */
export function kindFromMediaType(value: unknown): MediaKind {
  const mediaType = safeMediaType(value);
  if (mediaType?.startsWith("image/")) return "image";
  if (mediaType?.startsWith("audio/")) return "audio";
  if (mediaType?.startsWith("video/")) return "video";
  return "file";
}

/** Return whether a record is a canonical media part. */
export function isMediaPart(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { type: MediaKind; source: unknown } {
  return (
    (value.type === "image" ||
      value.type === "audio" ||
      value.type === "video" ||
      value.type === "file") &&
    "source" in value
  );
}

/** Return whether a record is a canonical asset source. */
export function isAsset(value: Record<string, unknown>): boolean {
  return (
    value.type === "data" ||
    value.type === "url" ||
    value.type === "provider-file" ||
    value.type === "asset-ref"
  );
}

export function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function sourceCategory(source: unknown): SourceCategory {
  if (typeof source === "string")
    return source.trimStart().toLowerCase().startsWith("data:")
      ? "data-url"
      : "url";
  if (source instanceof URL) return "url";
  if (source instanceof Uint8Array || source instanceof ArrayBuffer)
    return "bytes";
  if (isBlob(source)) return "blob";
  if (!isRecord(source)) return "unknown";
  if ("ref" in source || source.type === "asset-ref") return "asset-ref";
  if (source.type === "data") return "data";
  if (source.type === "url") return "url";
  if (source.type === "provider-file") return "provider-file";
  return "unknown";
}

function digestBytes(bytes: Uint8Array): string | undefined {
  return bytes.byteLength <= MAX_DESCRIPTOR_HASH_BYTES
    ? sha256Hex(bytes).slice(0, 12)
    : undefined;
}

function digestPrefix(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{8,}$/i.test(value)
    ? value.slice(0, 12).toLowerCase()
    : undefined;
}

function optionalFact(key: string, value: unknown): Record<string, number> {
  const fact = safeNumber(value);
  return fact === undefined ? {} : { [key]: fact };
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safeMediaType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const essence = value.split(";", 1)[0]?.trim().toLowerCase();
  return essence && MIME_ESSENCE.test(essence) ? essence : undefined;
}

function blobMediaType(value: unknown): string | undefined {
  if (isBlob(value)) return safeMediaType(value.type);
  if (typeof value !== "string" || !value.toLowerCase().startsWith("data:"))
    return undefined;
  return safeMediaType(value.slice(5).split(/[;,]/, 1)[0]);
}

function byteView(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  return value instanceof ArrayBuffer ? new Uint8Array(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
