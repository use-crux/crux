import type {
  PromptLatestRunError,
  PromptLatestRunResponse,
  PromptLatestRunResult,
} from "./types";

const MAX_ID_CODE_UNITS = 512;
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;

const unavailableMessages = {
  "owner-not-found":
    "This Prompt is no longer present in the current Project Index.",
  "owner-not-prompt":
    "Latest Run is available only for canonical Prompt definitions.",
} as const satisfies Readonly<Record<string, string>>;

const errorMessages = {
  invalid_request: "The latest-Run request is invalid.",
  forbidden: "The latest-Run request is not allowed.",
  method_not_allowed: "This latest-Run method is not allowed.",
  temporarily_unavailable: "Latest Run is temporarily unavailable. Retry.",
} as const satisfies Readonly<Record<string, string>>;

type ExactObject<Keys extends PropertyKey> = Readonly<Record<Keys, unknown>>;

/**
 * Decode one recursively strict latest-Run response and bind every destination
 * back to the owner requested by the current resolver page.
 *
 * @throws When the response contains unknown fields, invalid identities, or a
 * noncanonical destination.
 */
export function decodePromptLatestRunResult(
  value: unknown,
  requestedDefinitionId: string,
): PromptLatestRunResponse {
  const envelope = exactObject(value, ["status"] as const, true);
  switch (envelope.status) {
    case "found":
      return decodeFound(value, requestedDefinitionId);
    case "empty":
      return decodeEmpty(value, requestedDefinitionId);
    case "unavailable":
      return decodeUnavailable(value);
    case "error":
      return decodeError(value);
    default:
      throw new Error("Invalid latest-Run response status.");
  }
}

function decodeFound(
  value: unknown,
  requestedDefinitionId: string,
): Extract<PromptLatestRunResult, { readonly status: "found" }> {
  const found = exactObject(value, [
    "status",
    "definitionId",
    "observabilityRevision",
    "operationId",
    "path",
  ] as const);
  if (
    found.status !== "found" ||
    found.definitionId !== requestedDefinitionId ||
    !validRevision(found.observabilityRevision) ||
    !validID(found.operationId)
  ) {
    throw new Error("Invalid latest-Run found response.");
  }
  const path = `/runs/${encodeURIComponent(found.operationId)}`;
  if (found.path !== path) {
    throw new Error("Noncanonical latest-Run destination.");
  }
  return {
    status: "found",
    definitionId: requestedDefinitionId,
    observabilityRevision: found.observabilityRevision,
    operationId: found.operationId,
    path,
  };
}

function decodeEmpty(
  value: unknown,
  requestedDefinitionId: string,
): Extract<PromptLatestRunResult, { readonly status: "empty" }> {
  const empty = exactObject(value, [
    "status",
    "definitionId",
    "observabilityRevision",
    "path",
    "exactPreview",
  ] as const);
  const exactPreview = exactObject(empty.exactPreview, ["status"] as const);
  if (
    empty.status !== "empty" ||
    empty.definitionId !== requestedDefinitionId ||
    !validRevision(empty.observabilityRevision) ||
    (exactPreview.status !== "available" &&
      exactPreview.status !== "unavailable")
  ) {
    throw new Error("Invalid latest-Run empty response.");
  }
  const path = `/library/index/${encodeURIComponent(requestedDefinitionId)}/runs`;
  if (empty.path !== path) {
    throw new Error("Noncanonical latest-Run empty destination.");
  }
  return {
    status: "empty",
    definitionId: requestedDefinitionId,
    observabilityRevision: empty.observabilityRevision,
    path,
    exactPreview: { status: exactPreview.status },
  };
}

function decodeUnavailable(value: unknown): PromptLatestRunResult {
  const unavailable = exactObject(value, [
    "status",
    "reason",
    "message",
  ] as const);
  if (
    unavailable.status !== "unavailable" ||
    (unavailable.reason !== "owner-not-found" &&
      unavailable.reason !== "owner-not-prompt") ||
    typeof unavailable.message !== "string" ||
    unavailable.message !== unavailableMessages[unavailable.reason]
  ) {
    throw new Error("Invalid latest-Run unavailable response.");
  }
  return {
    status: "unavailable",
    reason: unavailable.reason,
    message: unavailable.message,
  };
}

function decodeError(value: unknown): PromptLatestRunError {
  const error = exactObject(value, ["status", "code", "message"] as const);
  if (
    error.status !== "error" ||
    !isErrorCode(error.code) ||
    typeof error.message !== "string" ||
    error.message !== errorMessages[error.code]
  ) {
    throw new Error("Invalid latest-Run error response.");
  }
  return { status: "error", code: error.code, message: error.message };
}

function exactObject<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
  allowAdditional = false,
): ExactObject<Keys[number]> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("Expected a plain latest-Run object.");
  }
  const actual = Object.keys(value);
  if (
    (!allowAdditional && actual.length !== keys.length) ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    (!allowAdditional && actual.some((key) => !keys.includes(key)))
  ) {
    throw new Error("Invalid latest-Run object fields.");
  }
  return value as ExactObject<Keys[number]>;
}

function validRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_REVISION
  );
}

function validID(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_ID_CODE_UNITS
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isErrorCode(value: unknown): value is keyof typeof errorMessages {
  return typeof value === "string" && Object.hasOwn(errorMessages, value);
}
