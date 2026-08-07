/**
 * Normalized-outcome mapping for the AI SDK loop runtime.
 *
 * The Vercel AI SDK already normalizes usage and completed tool calls, but its
 * finish reasons and error surface are parallel taxonomies that leak raw into
 * consumers. This module closes both gaps with pure functions:
 *
 * - {@link mapAiSdkFinishReason} clamps the SDK's unified finish vocabulary to
 *   the closed provider-neutral {@link CruxFinishReason} union.
 * - {@link mapAiSdkError} classifies AI SDK call errors into the shared
 *   {@link CruxProviderError} taxonomy from structural fields (`statusCode`/
 *   `status`, `isRetryable`, `name`), so `generate()`/`stream()` on the runtime
 *   path surface the same normalized shape as the native single-turn adapters.
 *
 * Neither function calls the SDK; both are safe on edge/serverless runtimes.
 *
 * @module
 */

import { cruxProviderError } from "@use-crux/core/adapter";
import type {
  CruxFinishReason,
  CruxProviderError,
} from "@use-crux/core/adapter";

/**
 * Clamp an AI SDK finish reason to the closed {@link CruxFinishReason} union.
 *
 * The AI SDK's unified vocabulary (`stop`/`length`/`content-filter`/
 * `tool-calls`/`error`/`other`/`unknown`) is mostly aligned with Crux, but
 * `other` and any unrecognized value must collapse to `unknown` rather than
 * leak through. The SDK has no distinct refusal concept — model-side blocking
 * folds into `content-filter` — so this mapper never produces `refusal`.
 *
 * @param finishReason - The raw AI SDK finish reason, if any.
 * @returns The normalized finish reason, or `undefined` when none was reported.
 */
export function mapAiSdkFinishReason(
  finishReason: string | null | undefined,
): CruxFinishReason | undefined {
  switch (finishReason) {
    case null:
    case undefined:
      return undefined;
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
      return "tool-calls";
    case "content-filter":
      return "content-filter";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

/** Read a numeric HTTP status from an AI SDK error's `statusCode`/`status`. */
function readStatus(error: Error): number | undefined {
  const record = error as { statusCode?: unknown; status?: unknown };
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  return undefined;
}

/** Read the structural `isRetryable` hint AI SDK `APICallError` exposes. */
function readIsRetryable(error: Error): boolean | undefined {
  const record = error as { isRetryable?: unknown };
  return typeof record.isRetryable === "boolean"
    ? record.isRetryable
    : undefined;
}

/**
 * Classify an AI SDK call error into the normalized {@link CruxProviderError}
 * taxonomy.
 *
 * Distinguishes rate-limit (`429`), invalid request (`4xx`, with
 * authentication called out for `401`/`403`), retryable server errors (`5xx`),
 * and retryable connection/transport failures (no status but `isRetryable`),
 * plus timeout and abort surfaces recognized by error name. Returns `undefined`
 * for values it does not recognize, deferring to core's generic classification
 * (which already covers `TimeoutError` and cooperative aborts).
 *
 * @param error - The thrown value from an AI SDK gateway call.
 * @returns A normalized provider error, or `undefined` when unrecognized.
 */
export function mapAiSdkError(error: unknown): CruxProviderError | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = error.message;
  const name = error.name;

  // Cooperative aborts are handled by core's `normalizeAdapterCallError`, but
  // AI SDK names its own abort error so classify it here for a stable code.
  if (name === "AbortError" || name === "AI_AbortError") {
    return cruxProviderError({
      kind: "aborted",
      code: "ai-sdk.aborted",
      retryable: false,
    });
  }

  if (/timeout/i.test(name)) {
    return cruxProviderError({
      kind: "timeout",
      code: "ai-sdk.timeout",
      retryable: true,
      message,
    });
  }

  if (name === "AI_NoOutputGeneratedError") {
    return cruxProviderError({
      kind: "invalid-response",
      code: "ai-sdk.no_output_generated",
      retryable: true,
    });
  }

  const status = readStatus(error);
  const isRetryable = readIsRetryable(error);

  if (
    (status === 400 || status === 422) &&
    /(?:response[_ -]?format|json schema|structured output).*(?:invalid|unsupported|reject)|(?:invalid|unsupported|reject).*(?:response[_ -]?format|json schema|structured output)|invalid schema for (?:function|tool)\b/i.test(
      message,
    )
  ) {
    return cruxProviderError({
      kind: "invalid-request",
      code: "ai-sdk.schema_rejected",
      retryable: false,
    });
  }

  if (status === 429) {
    return cruxProviderError({
      kind: "rate-limit",
      code: "ai-sdk.rate_limit",
      retryable: true,
      message,
    });
  }
  if (status === 408) {
    return cruxProviderError({
      kind: "timeout",
      code: "ai-sdk.timeout",
      retryable: true,
      message,
    });
  }
  if (status === 401 || status === 403) {
    return cruxProviderError({
      kind: "invalid-request",
      code: "ai-sdk.authentication",
      retryable: false,
      message,
    });
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return cruxProviderError({
      kind: "invalid-request",
      code: "ai-sdk.invalid_request",
      retryable: false,
      message,
    });
  }
  if (status !== undefined && status >= 500) {
    return cruxProviderError({
      kind: "provider-error",
      code: "ai-sdk.server_error",
      retryable: true,
      message,
    });
  }

  // No HTTP status: a retryable AI SDK error is a connection/transport failure.
  if (isRetryable === true || name === "AI_RetryError") {
    return cruxProviderError({
      kind: "provider-error",
      code: "ai-sdk.connection_error",
      retryable: true,
      message,
    });
  }
  if (name === "AI_APICallError") {
    return cruxProviderError({
      kind: "provider-error",
      code: "ai-sdk.provider_error",
      retryable: false,
      message,
    });
  }

  return undefined;
}
