import { base64ToBytes } from "./base64";
import { createInvalidMediaSourceError } from "./media-errors";

const DATA_URL_MAX_BYTES = 20 * 1024 * 1024;
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
  try {
    return new TextEncoder().encode(decodeURIComponent(value));
  } catch {
    throw invalid(path, "Malformed data URL payload.");
  }
}

function decodeStrictBase64(value: string, path: string): Uint8Array {
  const compact = value.replace(/\s/g, "");
  if (!BASE64_RE.test(compact) || compact.length % 4 === 1) {
    throw invalid(path, "Malformed data URL base64 payload.");
  }
  return base64ToBytes(compact);
}

function invalid(path: string, reason: string): never {
  throw createInvalidMediaSourceError({ path, reason });
}
