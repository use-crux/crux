/**
 * Model fallback primitive — wraps multiple models into a single reference
 * that tries each in order on qualifying failure.
 *
 * @module
 */

import { isValidationExhaustedError } from "./validation-retry";
import { isCruxAdapterError } from "../adapter/normalized-outcome";
import { RequestCompositionError } from "../request/errors";
import { FallbackExhaustedError } from "../routing/errors";
import type {
  BoundOf,
  ComposedCtx,
  ComposedStream,
  InOf,
  RoutingPhantom,
} from "../routing/types";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Error categories that can trigger a fallback attempt. */
export type ErrorCategory =
  | "rate_limit"
  | "timeout"
  | "server_error"
  | "connection_error"
  | "auth_error"
  | "invalid_response"
  | "schema_incompatible"
  | "input_limit";

/** Per-fallback timeout budgets. */
export interface FallbackTimeoutOptions {
  /** Maximum time for one fallback attempt. */
  readonly attempt?: number;
  /** Maximum time to first stream token for one attempt. */
  readonly firstToken?: number;
}

/** Information passed to the fallback transition hook. */
export interface FallbackHookInfo<M = unknown> {
  /** Model that just failed. */
  readonly from: M;
  /** Next model that will be attempted. */
  readonly to: M;
  /** 1-based attempt number that failed. */
  readonly attempt: number;
  /** Original provider/runtime error. */
  readonly error: Error;
}

/** Options for configuring fallback behavior. */
export interface FallbackOptions {
  /** Stable id used to join authored index definitions with fallback attempt spans. */
  id?: string;
  /** Human-readable description for index and devtools surfaces. */
  description?: string;
  /** Which error categories trigger fallback. Defaults to all categories. */
  on?: ErrorCategory[];
  /** Custom predicate — when set, takes priority over `on`. */
  shouldFallback?: (error: Error) => boolean;
  /**
   * Predicate for successful-but-unusable responses.
   *
   * Returning true records an `invalid_response` attempt and tries the next
   * fallback candidate. Predicate errors are observed and treated as false.
   */
  when?: (result: unknown) => boolean | Promise<boolean>;
  /** Per-attempt and first-token timeout budgets. */
  timeout?: FallbackTimeoutOptions;
  /** Called when a failed attempt is about to fall through to the next model. */
  onFallback?: (info: FallbackHookInfo) => void | Promise<void>;
}

/** A fallback model wrapper — recognized by adapters via `isFallback()`. */
export interface FallbackModel<M = unknown> extends RoutingPhantom<
  InOf<M>,
  ComposedCtx<object, M>,
  ComposedStream<M>,
  BoundOf<M>,
  never
> {
  readonly _tag: "crux.fallback";
  readonly models: readonly M[];
  readonly options: FallbackOptions;
}

// ─────────────────────────────────────────────────────────────────
// fallback()
// ─────────────────────────────────────────────────────────────────

/**
 * Create a fallback model wrapper that tries models in order.
 *
 * Pass a readonly tuple of at least two models, optionally followed by
 * fallback options.
 *
 * @example
 * ```ts
 * import { fallback } from '@use-crux/core'
 *
 * const model = fallback([gpt4o, claudeSonnet, geminiFlash])
 *
 * const model = fallback([gpt4o, claudeSonnet], {
 *   on: ['rate_limit', 'timeout'],
 *   timeout: { attempt: 10_000 },
 * })
 * ```
 */
export function fallback<
  const Ms extends readonly [unknown, unknown, ...unknown[]],
>(models: Ms, options: FallbackOptions = {}): FallbackModel<Ms[number]> {
  if (models.length < 2) {
    throw new Error("fallback() requires at least 2 models");
  }

  return Object.freeze({
    _tag: "crux.fallback" as const,
    models: Object.freeze([...models]),
    options,
    __phantom: undefined as unknown as FallbackModel<Ms[number]>["__phantom"],
  });
}

/** Type guard — returns `true` if the model is a `FallbackModel` wrapper. */
export function isFallback(model: unknown): model is FallbackModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === "object" &&
    "_tag" in model &&
    (model as { _tag: unknown })._tag === "crux.fallback"
  );
}

// ─────────────────────────────────────────────────────────────────
// classifyError()
// ─────────────────────────────────────────────────────────────────

/**
 * Classify an error into a fallback error category.
 *
 * Returns `null` if the error doesn't match any known category
 * (e.g., validation errors, content policy violations).
 */
export function classifyError(error: unknown): ErrorCategory | null {
  return classifyErrorBounded(error, new Set(), 0);
}

const MAX_CLASSIFICATION_DEPTH = 16;
const MAX_COLLECTION_ERRORS = 32;

function classifyErrorBounded(
  error: unknown,
  seen: Set<object>,
  depth: number,
): ErrorCategory | null {
  if (!(error instanceof Error)) return null;
  if (depth > MAX_CLASSIFICATION_DEPTH) return null;
  if (seen.has(error)) return null;
  seen.add(error);

  if (
    error instanceof RequestCompositionError &&
    error.code === "REQUEST_TOO_LARGE"
  ) {
    return "input_limit";
  }

  const structuredCode = (error as { code?: unknown }).code;
  if (
    structuredCode === "invalid-capability-profile" ||
    structuredCode === "unsupported-structured-output" ||
    structuredCode === "unsupported-schema"
  )
    return "schema_incompatible";

  if (error instanceof FallbackExhaustedError) {
    return classifyUniformCollection(error.errors, seen, depth);
  }

  if (error instanceof AggregateError) {
    return classifyUniformCollection(error.errors, seen, depth);
  }

  const causeCategory = classifyErrorBounded(
    (error as { cause?: unknown }).cause,
    seen,
    depth + 1,
  );
  if (
    causeCategory === "input_limit" ||
    causeCategory === "schema_incompatible"
  ) {
    return causeCategory;
  }

  // Validation exhaustion (all retries failed on structured output)
  if (isValidationExhaustedError(error)) return "invalid_response";

  // Adapter boundaries intentionally replace provider-specific status/error
  // shapes with the shared closed taxonomy. Route on that normalized evidence
  // before falling back to legacy SDK status/code inspection.
  if (isCruxAdapterError(error)) {
    const { kind, code } = error.providerError;
    if (code === "ai-sdk.schema_rejected") return "schema_incompatible";
    if (kind === "rate-limit") return "rate_limit";
    if (kind === "timeout") return "timeout";
    if (kind === "invalid-request" && code.endsWith(".authentication"))
      return "auth_error";
    if (kind === "invalid-response") return "invalid_response";
    if (kind === "provider-error" && code.includes("connection"))
      return "connection_error";
    if (kind === "provider-error" && error.providerError.retryable)
      return "server_error";
    return null;
  }

  // Check HTTP status codes (works with OpenAI APIError, Anthropic errors, etc.)
  const errShape = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  if (
    errShape.code === "no_image_generated" ||
    errShape.code === "no_transcript"
  ) {
    return "invalid_response";
  }
  const status = errShape.status ?? errShape.statusCode;
  if (typeof status === "number") {
    if (status === 429) return "rate_limit";
    if (status === 401 || status === 403) return "auth_error";
    if (status >= 500 && status < 600) return "server_error";
    // 4xx errors (400, 404, 422, etc.) are not retryable
    return null;
  }

  // Check error codes (Node.js system errors)
  const code = errShape.code;
  if (typeof code === "string") {
    if (code === "ETIMEDOUT" || code === "TIMEOUT") return "timeout";
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ECONNRESET"
    ) {
      return "connection_error";
    }
  }

  // Crux structured timeout and AbortError (from provider AbortController timeout).
  if (error.name === "TimeoutError" || error.name === "AbortError")
    return "timeout";

  // fetch TypeError ("fetch failed", "network error")
  if (
    error instanceof TypeError &&
    /fetch failed|network/i.test(error.message)
  ) {
    return "connection_error";
  }

  return null;
}

function classifyUniformCollection(
  errors: readonly unknown[],
  seen: Set<object>,
  depth: number,
): ErrorCategory | null {
  if (errors.length === 0) return null;
  if (errors.length > MAX_COLLECTION_ERRORS) return null;
  let category: ErrorCategory | null = null;
  for (const error of errors) {
    const member = classifyErrorBounded(error, new Set(seen), depth + 1);
    if (member !== "input_limit" && member !== "schema_incompatible")
      return null;
    if (category !== null && member !== category) return null;
    category = member;
  }
  return category;
}

/**
 * Check whether an error should trigger fallback based on options.
 *
 * If `shouldFallback` predicate is set, it takes priority.
 * Otherwise checks `on` categories (defaults to all categories if `on` is not set).
 */
export function shouldAttemptFallback(
  error: Error,
  options: FallbackOptions,
): boolean {
  // Custom predicate takes priority
  if (options.shouldFallback) {
    return options.shouldFallback(error);
  }

  const category = classifyError(error);
  if (category === null) return false;

  // If `on` is specified, only those categories trigger fallback
  if (options.on && options.on.length > 0) {
    return options.on.includes(category);
  }

  // Default: all classified errors trigger fallback
  return true;
}

// ─────────────────────────────────────────────────────────────────
