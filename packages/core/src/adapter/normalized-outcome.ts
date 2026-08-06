/**
 * Provider-neutral normalized outcome taxonomy for adapter calls.
 *
 * Every provider adapter maps its native finish reason and error surface into
 * this closed vocabulary so `generate()` and `stream()` report one shape across
 * providers. The taxonomy is intentionally small and closed: bounded provider
 * detail lives in `code` (a namespaced, closed-ish string), never in an
 * unbounded raw-payload escape hatch. Any human-readable `message` is routed
 * through the shared observability redaction path before it is retained.
 *
 * This module is runtime/edge/serverless safe — it imports no Node-only APIs.
 *
 * @module
 */

import { toSafeJsonValue } from "../observability/errors";
import { TimeoutError } from "../generation/timeout";

/**
 * Closed, provider-neutral finish-reason vocabulary.
 *
 * Adapters map their native stop reason into exactly one of these values; the
 * raw provider string never reaches a consumer.
 */
export type CruxFinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "refusal"
  | "error"
  | "aborted"
  | "unknown";

/**
 * Closed, provider-neutral error-kind vocabulary.
 *
 * `refusal`/`safety`/`content-filter` cover model-side blocking; `rate-limit`/
 * `timeout`/`aborted`/`invalid-request`/`provider-error` cover transport and
 * request outcomes; `invalid-response` covers a completed call that produced
 * no usable model response; `unknown` is the honest fallback.
 */
export type CruxProviderErrorKind =
  | "refusal"
  | "safety"
  | "content-filter"
  | "rate-limit"
  | "timeout"
  | "aborted"
  | "invalid-request"
  | "invalid-response"
  | "provider-error"
  | "unknown";

/**
 * Normalized provider error.
 *
 * The shape is deliberately closed: `kind` classifies what happened, `code`
 * carries bounded per-provider identity (e.g. `anthropic.stream_completion_failed`),
 * and `retryable` states whether a retry could plausibly succeed. The optional
 * `message` is redacted human-readable text, never a raw provider payload.
 */
export interface CruxProviderError {
  readonly kind: CruxProviderErrorKind;
  /** Bounded, per-provider-namespaced machine identifier for what happened. */
  readonly code: string;
  readonly retryable: boolean;
  /** Redacted human-readable detail, present only when meaningful. */
  readonly message?: string;
}

/** Input for {@link cruxProviderError}; `message` is redacted before it is stored. */
export interface CruxProviderErrorInput {
  readonly kind: CruxProviderErrorKind;
  readonly code: string;
  readonly retryable: boolean;
  readonly message?: unknown;
}

/**
 * Route arbitrary human-readable error text through the shared observability
 * redaction path (`toSafeJsonValue`): sensitive keys are stripped and long
 * strings are truncated. Empty or absent input yields `undefined`.
 *
 * @param message - Raw message candidate (string, Error message, or unknown).
 * @returns Redacted string, or `undefined` when there is nothing to keep.
 */
export function redactProviderMessage(message: unknown): string | undefined {
  if (message === undefined || message === null) return undefined;
  const text = typeof message === "string" ? message : String(message);
  if (text.length === 0) return undefined;
  const safe = toSafeJsonValue(text);
  return typeof safe === "string" && safe.length > 0 ? safe : undefined;
}

/**
 * Construct a {@link CruxProviderError}, redacting any `message` through the
 * shared path and omitting it entirely when nothing survives redaction.
 *
 * @param input - Kind, bounded code, retryability, and an optional raw message.
 * @returns A frozen normalized provider error.
 */
export function cruxProviderError(
  input: CruxProviderErrorInput,
): CruxProviderError {
  const message = redactProviderMessage(input.message);
  return Object.freeze({
    kind: input.kind,
    code: input.code,
    retryable: input.retryable,
    ...(message !== undefined ? { message } : {}),
  });
}

/**
 * Error thrown by adapters when a provider call fails.
 *
 * Carrying a normalized {@link CruxProviderError} means a failure surfaces to
 * the caller (and the observability capture path) as a classified outcome
 * instead of a silent `undefined` or a raw provider exception.
 */
export class CruxAdapterError extends Error {
  /** The normalized, provider-neutral classification of this failure. */
  readonly providerError: CruxProviderError;

  constructor(providerError: CruxProviderError, options?: { cause?: unknown }) {
    super(
      providerError.message ?? `${providerError.kind}: ${providerError.code}`,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "CruxAdapterError";
    this.providerError = providerError;
  }
}

/** Type guard for {@link CruxAdapterError}. */
export function isCruxAdapterError(value: unknown): value is CruxAdapterError {
  return value instanceof CruxAdapterError;
}

/** Options controlling how a thrown provider-call error is classified. */
export interface NormalizeAdapterCallErrorOptions {
  /** Provider id used to namespace the fallback `code`. */
  readonly providerId: string;
  /** The caller's abort signal, used to distinguish a user abort from a timeout. */
  readonly signal?: AbortSignal;
  /** Provider-specific classifier for native SDK errors. */
  readonly mapError?: (error: unknown) => CruxProviderError | undefined;
}

/**
 * Normalize a thrown provider-call error into a {@link CruxAdapterError}.
 *
 * Classification order: an already-normalized error passes through; a Crux
 * budget {@link TimeoutError} becomes `kind: 'timeout'`; a user abort becomes
 * `kind: 'aborted'`; otherwise the provider's `mapError` decides, falling back
 * to a generic `provider-error`.
 *
 * @param error - The raw thrown value from the provider call.
 * @param options - Provider id, caller signal, and provider error classifier.
 * @returns A normalized adapter error carrying the original as its `cause`.
 */
export function normalizeAdapterCallError(
  error: unknown,
  options: NormalizeAdapterCallErrorOptions,
): CruxAdapterError {
  if (isCruxAdapterError(error)) return error;

  if (TimeoutError.isInstance(error)) {
    return new CruxAdapterError(
      cruxProviderError({
        kind: "timeout",
        code: `crux.timeout.${error.budget}`,
        retryable: true,
        message: error.message,
      }),
      { cause: error },
    );
  }

  if (isAbortError(error, options.signal)) {
    return new CruxAdapterError(
      cruxProviderError({ kind: "aborted", code: "crux.aborted", retryable: false }),
      { cause: error },
    );
  }

  const mapped = options.mapError?.(error);
  if (mapped) return new CruxAdapterError(mapped, { cause: error });

  return new CruxAdapterError(
    cruxProviderError({
      kind: "provider-error",
      code: `${options.providerId}.provider_error`,
      retryable: false,
      message: error instanceof Error ? error.message : error,
    }),
    { cause: error },
  );
}

/** Whether a thrown value represents a cooperative abort. */
function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true;
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Classify a thrown HTTP-shaped provider SDK error by status and error name.
 *
 * Anthropic and OpenAI SDK errors both expose a numeric `status` and the same
 * connection/abort/timeout error-class names, so this shared classifier keeps
 * their normalized taxonomy identical. Returns `undefined` for values it does
 * not recognize, deferring to core's generic classification.
 *
 * @param error - The thrown value from the provider SDK.
 * @param providerId - Provider id used to namespace the resulting `code`.
 * @returns A normalized provider error, or `undefined` when unrecognized.
 */
export function classifyProviderHttpError(
  error: unknown,
  providerId: string,
): CruxProviderError | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = error.message;

  if (error.name === "APIUserAbortError") {
    return cruxProviderError({
      kind: "aborted",
      code: `${providerId}.aborted`,
      retryable: false,
    });
  }
  if (error.name === "APIConnectionTimeoutError") {
    return cruxProviderError({
      kind: "timeout",
      code: `${providerId}.timeout`,
      retryable: true,
      message,
    });
  }

  const rawStatus = (error as { status?: unknown }).status;
  const status = typeof rawStatus === "number" ? rawStatus : undefined;
  if (status === undefined) {
    if (error.name === "APIConnectionError") {
      return cruxProviderError({
        kind: "provider-error",
        code: `${providerId}.connection_error`,
        retryable: true,
        message,
      });
    }
    return undefined;
  }

  if (status === 429) {
    return cruxProviderError({
      kind: "rate-limit",
      code: `${providerId}.rate_limit`,
      retryable: true,
      message,
    });
  }
  if (status === 408) {
    return cruxProviderError({
      kind: "timeout",
      code: `${providerId}.timeout`,
      retryable: true,
      message,
    });
  }
  if (status === 401 || status === 403) {
    return cruxProviderError({
      kind: "invalid-request",
      code: `${providerId}.authentication`,
      retryable: false,
      message,
    });
  }
  if (status >= 400 && status < 500) {
    return cruxProviderError({
      kind: "invalid-request",
      code: `${providerId}.invalid_request`,
      retryable: false,
      message,
    });
  }
  if (status >= 500) {
    return cruxProviderError({
      kind: "provider-error",
      code: `${providerId}.server_error`,
      retryable: true,
      message,
    });
  }
  return undefined;
}
