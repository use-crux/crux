import {
  blobDescriptor,
  bytesDescriptor,
  isAsset,
  isBlob,
  isMediaPart,
  kindFromMediaType,
  mediaDescriptor,
} from "./media-preview-descriptor";

const MAX_DEPTH = 8;
const MAX_KEYS = 100;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 64 * 1024;
const BASE64_LIKE = /^[a-z0-9+/=_-]+$/i;
const SENSITIVE_MEDIA_KEY =
  /^(?:file_?id|provider_?file_?id|filename|ref|uri|url)$/i;

interface SanitizeState {
  readonly seen: WeakSet<object>;
}

/** Replace media-bearing preview values with bounded allowlisted facts before serialization. */
export function sanitizeMediaPreview(value: unknown): unknown {
  try {
    return sanitizeValue(value, { seen: new WeakSet<object>() }, 0);
  } catch {
    return "[Uninspectable]";
  }
}

function sanitizeValue(
  value: unknown,
  state: SanitizeState,
  depth: number,
): unknown {
  if (value === null || value === undefined || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "symbol" || typeof value === "function")
    return String(value);
  if (value instanceof Uint8Array) return bytesDescriptor("file", value);
  if (value instanceof ArrayBuffer)
    return bytesDescriptor("file", new Uint8Array(value));
  if (value instanceof URL) return "[url]";
  if (isBlob(value)) return blobDescriptor("file", value);
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (typeof value !== "object") return String(value);
  if (state.seen.has(value)) return "[Circular]";

  if (Array.isArray(value)) return sanitizeArray(value, state, depth);
  if (!isRecord(value)) return String(value);
  if (isMediaPart(value))
    return mediaDescriptor(value.type, value.source, value);
  if (isAsset(value))
    return mediaDescriptor(kindFromMediaType(value.mediaType), value, value);

  state.seen.add(value);
  try {
    return sanitizeRecord(value, state, depth);
  } finally {
    state.seen.delete(value);
  }
}

function sanitizeArray(
  value: readonly unknown[],
  state: SanitizeState,
  depth: number,
): unknown[] {
  state.seen.add(value);
  try {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, state, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) result.push("[Truncated]");
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function sanitizeRecord(
  value: Record<string, unknown>,
  state: SanitizeState,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = safeKeys(value);
  for (const key of keys.slice(0, MAX_KEYS)) {
    const child = safeProperty(value, key);
    result[key] =
      key === "continuation"
        ? "[provider continuation]"
        : SENSITIVE_MEDIA_KEY.test(key)
          ? sanitizeLocator(key, child)
          : sanitizeValue(child, state, depth + 1);
  }
  if (keys.length > MAX_KEYS) result.__truncated = true;
  return result;
}

function sanitizeString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("data:") || isBase64Like(trimmed))
    return "[redacted media]";
  if (isUrlString(trimmed)) return "[url]";
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}[Truncated]`
    : value;
}

function sanitizeLocator(key: string, value: unknown): string {
  if (
    /^(?:url|uri)$/i.test(key) ||
    value instanceof URL ||
    (typeof value === "string" && isUrlString(value))
  )
    return "[url]";
  return "[redacted media]";
}

function isUrlString(value: string): boolean {
  return /^(?:https?|asset|convex|s3|gs):\/\//i.test(value);
}

function isBase64Like(value: string): boolean {
  if (!BASE64_LIKE.test(value) || /^[a-f0-9]+$/i.test(value)) return false;
  if (value.length >= 32 && /={1,2}$/.test(value)) return true;
  return (
    value.length >= 128 &&
    new Set(value.toLowerCase()).size >= 8 &&
    value.length % 4 === 0
  );
}

function safeKeys(value: object): string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function safeProperty(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
