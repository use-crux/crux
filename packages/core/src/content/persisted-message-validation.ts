import type { PersistedMessage } from "./persisted-message-types";
import { isPrivateJsonObject } from "./json-private";

/** Validate an untrusted record value before hydrating private messages. */
export function isPersistedMessages(
  value: unknown,
): value is readonly PersistedMessage[] {
  return Array.isArray(value) && value.every(isPersistedMessage);
}

function isPersistedMessage(value: unknown): value is PersistedMessage {
  if (!isRecord(value) || !isRole(value.role)) return false;
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
  if (value.type === "text") return typeof value.text === "string";
  if (value.type !== "image" && value.type !== "file") return false;
  return (
    isPersistedSource(value.source) &&
    optionalString(value.mediaType) &&
    optionalString(value.filename)
  );
}

function isPersistedSource(value: unknown): boolean {
  if (!isRecord(value) || !isPrivateInfo(value.info)) return false;
  switch (value.type) {
    case "asset-ref":
      return (
        isRecord(value.ref) &&
        typeof value.ref.uri === "string" &&
        typeof value.mediaType === "string"
      );
    case "url":
      return typeof value.url === "string" && optionalString(value.mediaType);
    case "provider-file":
      return (
        typeof value.provider === "string" &&
        typeof value.fileId === "string" &&
        optionalString(value.mediaType)
      );
    default:
      return false;
  }
}

function isPrivateInfo(value: unknown): boolean {
  return value === undefined || isPrivateJsonObject(value);
}

function isProviderOptions(value: unknown): boolean {
  return value === undefined || isPrivateJsonObject(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isRole(value: unknown): boolean {
  return (
    value === "system" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
