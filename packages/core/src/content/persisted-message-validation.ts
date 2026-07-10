import type { AssetInfo } from "../asset";
import type {
  PersistedMediaSource,
  PersistedMessage,
} from "./persisted-message-types";
import { isPrivateJsonObject } from "./json-private";

const MIME_ESSENCE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const INFO_KEYS = new Set([
  "filename",
  "size",
  "sha256",
  "width",
  "height",
  "durationInSeconds",
  "pageCount",
]);

/** Validate an untrusted record value before hydrating private messages. */
export function isPersistedMessages(
  value: unknown,
): value is readonly PersistedMessage[] {
  return Array.isArray(value) && value.every(isPersistedMessage);
}

function isPersistedMessage(value: unknown): value is PersistedMessage {
  if (!isRecord(value) || !hasOnlyKeys(value, "role", "content", "metadata"))
    return false;
  if (!isRole(value.role)) return false;
  if (value.metadata !== undefined && !isPrivateJsonObject(value.metadata))
    return false;
  return (
    typeof value.content === "string" ||
    (Array.isArray(value.content) && value.content.every(isPersistedPart))
  );
}

function isPersistedPart(value: unknown): boolean {
  if (!isRecord(value) || !isProviderOptions(value.providerOptions))
    return false;
  if (value.type === "text") {
    return (
      hasOnlyKeys(value, "type", "text", "providerOptions") &&
      typeof value.text === "string"
    );
  }
  if (value.type !== "image" && value.type !== "file") return false;
  const allowedKeys = value.type === "image"
    ? ["type", "source", "mediaType", "providerOptions"]
    : ["type", "source", "mediaType", "filename", "providerOptions"];
  if (!hasOnlyKeys(value, ...allowedKeys)) return false;
  if (!isPersistedSource(value.source)) return false;
  if (!optionalMediaType(value.mediaType)) return false;
  const partMediaType =
    typeof value.mediaType === "string" ? value.mediaType : undefined;
  const sourceMediaType = value.source.mediaType;
  if (
    partMediaType !== undefined &&
    typeof sourceMediaType === "string" &&
    partMediaType !== sourceMediaType
  ) return false;
  const effectiveMediaType = partMediaType ?? sourceMediaType;
  if (
    value.type === "image" &&
    effectiveMediaType !== undefined &&
    !effectiveMediaType.startsWith("image/")
  ) return false;
  return (
    value.type === "image" ||
    optionalNonEmptyString(value.filename)
  );
}

function isPersistedSource(value: unknown): value is PersistedMediaSource {
  if (!isRecord(value) || !isAssetInfo(value.info)) return false;
  switch (value.type) {
    case "asset-ref":
      return (
        hasOnlyKeys(value, "type", "ref", "mediaType", "info") &&
        isRecord(value.ref) &&
        hasOnlyKeys(value.ref, "uri") &&
        nonEmptyString(value.ref.uri) &&
        isMediaType(value.mediaType)
      );
    case "url":
      return (
        hasOnlyKeys(value, "type", "url", "mediaType", "info") &&
        isHttpsUrl(value.url) &&
        optionalMediaType(value.mediaType)
      );
    case "provider-file":
      return (
        hasOnlyKeys(value, "type", "provider", "fileId", "mediaType", "info") &&
        nonEmptyString(value.provider) &&
        nonEmptyString(value.fileId) &&
        optionalMediaType(value.mediaType)
      );
    default:
      return false;
  }
}

function isAssetInfo(value: unknown): value is AssetInfo | undefined {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).some((key) => !INFO_KEYS.has(key)))
    return false;
  return (
    optionalNonEmptyString(value.filename) &&
    optionalFiniteNonNegative(value.size) &&
    (value.sha256 === undefined ||
      (typeof value.sha256 === "string" && SHA256.test(value.sha256))) &&
    optionalPositiveInteger(value.width) &&
    optionalPositiveInteger(value.height) &&
    optionalFiniteNonNegative(value.durationInSeconds) &&
    optionalPositiveInteger(value.pageCount)
  );
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isMediaType(value: unknown): value is string {
  return typeof value === "string" && MIME_ESSENCE.test(value);
}

function optionalMediaType(value: unknown): boolean {
  return value === undefined || isMediaType(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function optionalFiniteNonNegative(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function optionalPositiveInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value > 0)
  );
}

function isProviderOptions(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && Object.values(value).every(isPrivateJsonObject))
  );
}

function isRole(value: unknown): boolean {
  return (
    value === "system" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool"
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  ...keys: readonly string[]
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
