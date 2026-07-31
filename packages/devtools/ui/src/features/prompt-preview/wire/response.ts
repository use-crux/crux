import type { PromptPreviewBrowserResponse } from "../types";
import {
  exactWireKeys,
  nonnegativeSafeInteger,
  positiveSafeInteger,
  wireEnvironment,
  wireObject,
  wireString,
  type WireObject,
} from "./common";
import { decodeReadyPreview } from "./ready";

const MAX_RESULT_STRING_BYTES = 1_048_576;
const MAX_RESULT_BYTES = 2_097_152;
const utf8 = new TextEncoder();

const errorCodes = new Set([
  "invalid_request",
  "input_limit_exceeded",
  "no_peer",
  "environment_unavailable",
  "capability_unavailable",
  "target_unavailable",
  "catalogue_changed",
  "ambiguous_peer",
  "peer_disconnected",
  "target_disappeared",
  "deadline_exceeded",
  "cancelled",
  "invalid_response",
  "command_failed",
  "endpoint_not_allowed",
  "response_limit_exceeded",
  "internal_error",
]);

/** Strictly decode one complete browser-safe dispatch result. */
export function decodePromptPreviewBrowserResponse(
  value: unknown,
  definitionId: string,
): PromptPreviewBrowserResponse {
  wireString(definitionId, 1, 512);
  const object = wireObject(value);
  switch (object.status) {
    case "ready":
      decodeReady(object, definitionId);
      break;
    case "validation-error":
      decodeValidation(object);
      break;
    case "error":
      decodeError(object);
      break;
    default:
      throw new Error("invalid response status");
  }
  return object as PromptPreviewBrowserResponse;
}

function decodeReady(object: WireObject, definitionId: string): void {
  exactWireKeys(object, [
    "status",
    "peer",
    "catalogueRevision",
    "preview",
    "contributions",
  ]);
  positiveSafeInteger(object.catalogueRevision);
  const peer = wireObject(object.peer);
  exactWireKeys(peer, ["peerId", "runtimeName", "environment"]);
  wireString(peer.peerId, 1, 128);
  wireString(peer.runtimeName, 1, 256);
  wireEnvironment(peer.environment);
  decodeReadyPreview({
    preview: object.preview,
    contributions: object.contributions,
  });
  const runtimeResult = {
    status: "ready",
    targetId: definitionId,
    catalogueRevision: object.catalogueRevision,
    preview: object.preview,
    contributions: object.contributions,
  };
  if (
    countStringBytes(runtimeResult) > MAX_RESULT_STRING_BYTES ||
    utf8.encode(JSON.stringify(runtimeResult)).byteLength > MAX_RESULT_BYTES
  ) {
    throw new Error("runtime result limit");
  }
}

function decodeValidation(object: WireObject): void {
  exactWireKeys(object, [
    "status",
    "catalogueRevision",
    "issues",
    "omittedIssueCount",
  ]);
  positiveSafeInteger(object.catalogueRevision);
  nonnegativeSafeInteger(object.omittedIssueCount);
  if (!Array.isArray(object.issues) || object.issues.length > 128) {
    throw new Error("invalid issues");
  }
  object.issues.forEach((issue) => {
    const value = wireObject(issue);
    exactWireKeys(value, ["code", "path", "message"]);
    wireString(value.code, 1, 64);
    wireString(value.message, 1, 1024);
    if (!Array.isArray(value.path) || value.path.length > 32)
      throw new Error("invalid issue path");
    value.path.forEach((part) => {
      if (typeof part === "string") wireString(part, 0, 256);
      else nonnegativeSafeInteger(part);
    });
  });
}

function decodeError(object: WireObject): void {
  exactWireKeys(object, ["status", "code", "message"], ["choices"]);
  if (!errorCodes.has(String(object.code)))
    throw new Error("invalid error code");
  wireString(object.message, 1, 1024);
  if (object.choices !== undefined) {
    if (object.code !== "ambiguous_peer" || !Array.isArray(object.choices)) {
      throw new Error("invalid choices");
    }
    object.choices.forEach((choice) => {
      const value = wireObject(choice);
      exactWireKeys(value, ["peerId", "runtimeName", "environment"]);
      wireString(value.peerId, 1, 128);
      wireString(value.runtimeName, 1, 256);
      wireEnvironment(value.environment);
    });
  }
}

function countStringBytes(value: unknown): number {
  if (typeof value === "string") return utf8.encode(value).byteLength;
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + countStringBytes(child), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce(
    (total, child) => total + countStringBytes(child),
    0,
  );
}
