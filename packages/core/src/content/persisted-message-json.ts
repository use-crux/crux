import type { JsonObject, JsonValue } from "../types/tool";
import { createInvalidMediaSourceError } from "./media-errors";
import type { InvocationContentPart } from "./invocation-types";
import {
  clonePrivateJsonObject,
  isPrivateJsonObject,
  isPrivateJsonValue,
} from "./json-private";

/** Validate and clone a JSON value crossing the persistence boundary. */
export function projectPersistedJsonValue(
  value: unknown,
  path: string,
): JsonValue {
  if (!isPrivateJsonValue(value)) {
    throw createInvalidMediaSourceError({
      path,
      reason: "Tool-call input must be a JSON value to persist.",
    });
  }
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/** Validate and clone private message metadata for persistence. */
export function projectPersistedMetadata(
  metadata: unknown,
  path: string,
): JsonObject | undefined {
  if (metadata === undefined) return undefined;
  if (!isPrivateJsonObject(metadata)) {
    throw createInvalidMediaSourceError({
      path,
      reason: "Message metadata must be a JSON object.",
    });
  }
  return clonePrivateJsonObject(metadata);
}

/** Validate and clone private provider options for persistence. */
export function projectPersistedProviderOptions(
  providerOptions: unknown,
  path: string,
): { readonly providerOptions?: InvocationContentPart["providerOptions"] } {
  if (providerOptions === undefined) return {};
  if (!isPrivateJsonObject(providerOptions)) {
    throw createInvalidMediaSourceError({
      path,
      reason: "Provider options must be a JSON object.",
    });
  }
  return {
    providerOptions: clonePrivateJsonObject(
      providerOptions,
    ) as InvocationContentPart["providerOptions"],
  };
}
