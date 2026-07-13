/**
 * Generic handler wrappers for injected serverless lifetimes.
 *
 * @module
 */

import { runWithDeferInvocation } from "../host";
import type {
  DeferHandlerSettlement,
  DeferHostBoundaryOptions,
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from "../host-types";
import { createWaitUntilDeferLifetime } from "./wait-until";
import type { WaitUntilDeferLifetimeOptions } from "./wait-until";
import { createAfterDeferLifetime } from "./after";
import type { AfterDeferLifetimeOptions } from "./after";
import { createNamedOnlyDeferLifetime } from "./named-only";
import type { NamedOnlyDeferLifetimeOptions } from "./named-only";

/** Classification hook shared by serverless host wrappers. */
export type ServerlessDeferClassifyOutcome<T> = (
  settlement: DeferHandlerSettlement<T>,
) => DeferInvocationOutcome;

/** Options for {@link withServerlessDefer}. */
export interface ServerlessDeferWrapOptions<T> {
  /** Explicit lifetime — never inferred from platform environment names. */
  readonly lifetime: DeferLifetimeCapability;
  /**
   * Map handler settlement to a logical outcome synchronously.
   *
   * Defaults to success for returned values and error for throws. Framework
   * adapters own redirect/not-found/cancelled mapping.
   */
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
}

/**
 * Wrap any handler in an explicit deferred-work invocation boundary.
 *
 * Platform guessing never changes correctness: callers must supply a concrete
 * {@link DeferLifetimeCapability}.
 *
 * @example
 * ```ts
 * const handle = withServerlessDefer(handler, {
 *   lifetime: createWaitUntilDeferLifetime({ waitUntil }),
 * })
 * ```
 */
export function withServerlessDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: ServerlessDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const boundary: DeferHostBoundaryOptions<Awaited<TResult>> = {
    lifetime: options.lifetime,
    classifyOutcome:
      options.classifyOutcome ?? defaultClassifyOutcome<Awaited<TResult>>,
  };
  return (...args: TArgs) =>
    runWithDeferInvocation(() => handler(...args), boundary);
}

/** Options for {@link withWaitUntilDefer}. */
export type WaitUntilDeferWrapOptions<T> = WaitUntilDeferLifetimeOptions & {
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
};

/**
 * Wrap a handler with handler-returned waitUntil retention.
 *
 * Declares completion class `handler-returned`. Streaming response bodies may
 * still be in flight when deferred callbacks start.
 */
export function withWaitUntilDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: WaitUntilDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const { classifyOutcome, ...lifetimeOptions } = options;
  return withServerlessDefer(handler, {
    lifetime: createWaitUntilDeferLifetime(lifetimeOptions),
    ...(classifyOutcome ? { classifyOutcome } : {}),
  });
}

/** Options for {@link withAfterDefer}. */
export type AfterDeferWrapOptions<T> = AfterDeferLifetimeOptions & {
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
};

/**
 * Wrap a handler with response-finished after() retention.
 *
 * Declares completion class `response-finished`.
 */
export function withAfterDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: AfterDeferWrapOptions<Awaited<TResult>>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const { classifyOutcome, ...lifetimeOptions } = options;
  return withServerlessDefer(handler, {
    lifetime: createAfterDeferLifetime(lifetimeOptions),
    ...(classifyOutcome ? { classifyOutcome } : {}),
  });
}

/** Options for {@link withNamedOnlyDefer}. */
export type NamedOnlyDeferWrapOptions<T> = NamedOnlyDeferLifetimeOptions & {
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<T>;
};

/**
 * Wrap a handler for hosts that only support named Runtime deferred work.
 *
 * Inline `defer(callback)` throws `DEFER_CAPABILITY_MISSING`. Named staging
 * requires a configured Runtime Engine.
 */
export function withNamedOnlyDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: NamedOnlyDeferWrapOptions<Awaited<TResult>> = {},
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const { classifyOutcome, ...lifetimeOptions } = options;
  return withServerlessDefer(handler, {
    lifetime: createNamedOnlyDeferLifetime(lifetimeOptions),
    ...(classifyOutcome ? { classifyOutcome } : {}),
  });
}

function defaultClassifyOutcome<T>(
  settlement: DeferHandlerSettlement<T>,
): DeferInvocationOutcome {
  return settlement.kind === "returned" ? "success" : "error";
}
