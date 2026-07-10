import { base64ToBytes } from "./base64";
import { createInvalidMediaSourceError } from "./media-errors";

const DATA_URL_MAX_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARACTERS = Math.ceil(DATA_URL_MAX_BYTES / 3) * 4;
const PERCENT_DECODE_CHUNK_SIZE = 64 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function parseDataUrl(
  value: string,
  path: string,
): { readonly mediaType?: string; readonly data: Uint8Array } {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:") || comma < 0) {
    throw invalid(path, "Malformed data URL.");
  }
  const meta = value.slice(5, comma);
  const body = value.slice(comma + 1);
  const mediaType = meta.split(";").find((part) => part.includes("/"));
  const normalizedMediaType = mediaType
    ? normalizeMediaType(mediaType, path)
    : undefined;
  const data = meta.toLowerCase().split(";").includes("base64")
    ? decodeStrictBase64(body, path)
    : decodePercentEncodedData(body, path);
  if (data.byteLength > DATA_URL_MAX_BYTES) {
    throw invalid(
      path,
      `Data URL exceeds the ${DATA_URL_MAX_BYTES} byte limit.`,
    );
  }
  return {
    ...(normalizedMediaType ? { mediaType: normalizedMediaType } : {}),
    data,
  };
}

export function normalizeOptionalMediaType(
  value: string | undefined,
  path: string,
): string | undefined {
  return value === undefined ? undefined : normalizeMediaType(value, path);
}

export function normalizeMediaType(value: string, path: string): string {
  const essence = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence)) {
    throw invalid(path, "mediaType must be a valid MIME type essence.");
  }
  return essence;
}

export function looksLikeRawBase64(value: string): boolean {
  const compact = value.replace(/\s/g, "");
  return (
    compact.length >= 8 && compact.length % 4 === 0 && BASE64_RE.test(compact)
  );
}

function decodePercentEncodedData(value: string, path: string): Uint8Array {
  const encoder = new TextEncoder();
  let data: Uint8Array = new Uint8Array(
    Math.min(Math.max(value.length, 64), PERCENT_DECODE_CHUNK_SIZE),
  );
  let offset = 0;

  for (let index = 0; index < value.length; ) {
    if (value[index] === "%") {
      const encodedByte = value.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(encodedByte)) {
        throw invalid(path, "Malformed data URL payload.");
      }
      data = ensureCapacity(data, offset + 1, path);
      data[offset++] = Number.parseInt(encodedByte, 16);
      index += 3;
      continue;
    }
    const nextPercent = value.indexOf("%", index);
    const runEnd = nextPercent < 0 ? value.length : nextPercent;
    const chunkEnd = Math.min(runEnd, index + PERCENT_DECODE_CHUNK_SIZE);
    if (chunkEnd - index > DATA_URL_MAX_BYTES - offset) throwTooLarge(path);
    const encoded = encoder.encode(value.slice(index, chunkEnd));
    data = ensureCapacity(data, offset + encoded.byteLength, path);
    data.set(encoded, offset);
    offset += encoded.byteLength;
    index = chunkEnd;
  }
  return data.slice(0, offset);
}

function decodeStrictBase64(value: string, path: string): Uint8Array {
  if (value.length > MAX_BASE64_CHARACTERS) {
    throwTooLarge(path);
  }
  const compact = value.replace(/\s/g, "");
  if (!BASE64_RE.test(compact) || compact.length % 4 === 1) {
    throw invalid(path, "Malformed data URL base64 payload.");
  }
  return base64ToBytes(compact);
}

function ensureCapacity(data: Uint8Array, required: number, path: string): Uint8Array {
  if (required > DATA_URL_MAX_BYTES) throwTooLarge(path);
  if (required <= data.byteLength) return data;
  const capacity = Math.min(
    DATA_URL_MAX_BYTES,
    Math.max(required, Math.max(64, data.byteLength * 2)),
  );
  const expanded = new Uint8Array(capacity);
  expanded.set(data);
  return expanded;
}

function throwTooLarge(path: string): never {
  throw invalid(path, `Data URL exceeds the ${DATA_URL_MAX_BYTES} byte limit.`);
}

function invalid(path: string, reason: string): never {
  throw createInvalidMediaSourceError({ path, reason });
}
