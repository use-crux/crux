/**
 * Cloudflare Workers observability wrapper.
 *
 * Optional subpath: keeps the `ExecutionContext` shape out of the default
 * edge-safe `@use-crux/core/observability` graph. No `cloudflare:*` types or
 * runtime globals are imported here — {@link CruxExecutionContext} is a
 * structural duck type, so this module works against any object exposing
 * `waitUntil`, whether it came from `workerd`, a test harness, or another
 * platform with the same shape.
 *
 * Correctness does not depend on `AsyncLocalStorage`/`nodejs_compat`. A
 * Workers isolate can serve concurrent requests without ambient async
 * context, so this wrapper never scopes `observe.withHostLifecycle()`
 * around the handler (that call throws for async work without real ambient
 * storage — see `observability/delivery/host-scope.ts`). Instead it drains
 * the *entire* shared delivery queue in one bounded `observe.flush()` call
 * registered through `ctx.waitUntil()` after the handler settles.
 * `observe.flush()` waits on every pending/queued record regardless of which
 * request's ambient lifecycle (if any) originally deferred it, so this is
 * lossless for concurrent in-flight requests even though it is coarser than
 * per-record host-lifecycle attribution. `waitUntil` keeps the isolate alive
 * for the drain without adding latency to the returned `Response`, unlike
 * generic serverless wrappers that must await the drain before returning.
 *
 * @module
 */

import { observabilityDiagnostics, observe } from "./observe";
import type { ObservabilityFlushResult } from "./delivery/options";
import {
  withWaitUntilDefer,
  type ServerlessDeferClassifyOutcome,
} from "../defer/serverless";

const DEFAULT_WORKERS_FLUSH_TIMEOUT_MS = 5000;

/** Structural subset of Cloudflare's `ExecutionContext` this module depends on. */
export interface CruxExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Per-invocation knobs for a Workers-hosted handler. */
export interface CruxWorkersInvocation {
  /**
   * Bound for the final drain. Workers exposes no "remaining time" API, so
   * this uses a conservative fixed default unless supplied explicitly.
   * @default 5000
   */
  readonly flushTimeoutMs?: number;
  /**
   * Receives this invocation's final drain result.
   *
   * Omit to fall back to a console warning whenever the drain does not fully
   * complete (`status !== 'drained'`); the drain result is never silently
   * discarded either way.
   */
  readonly onDrain?: (result: ObservabilityFlushResult) => void;
}

/** Options for the opinionated Workers lifecycle boundary created by {@link withCrux}. */
export interface CruxWorkersOptions<TArgs extends readonly unknown[], TResult> {
  /** Resolve the structural Workers execution context for this call. */
  readonly context: (...args: TArgs) => CruxExecutionContext;
  /** Resolve optional per-invocation observability drain controls. */
  readonly invocation?: (
    context: CruxExecutionContext,
    ...args: TArgs
  ) => CruxWorkersInvocation | undefined;
  /** Classify the handler settlement for deferred-work finalization. */
  readonly classifyOutcome?: ServerlessDeferClassifyOutcome<Awaited<TResult>>;
  /** Whether named deferred work may finalize before the response. */
  readonly durableFinalization?: boolean;
  /** Whether inline deferred callbacks may register. Defaults to `true`. */
  readonly supportsInline?: boolean;
}

/**
 * Wrap a Workers handler with the canonical Crux defer and observability lifecycle.
 *
 * The handler result settles without waiting for telemetry. Both deferred work
 * and the bounded final drain are retained through the same structural
 * `ExecutionContext.waitUntil()` capability.
 *
 * @param handler - Workers handler to invoke.
 * @param options - Per-call context resolution and lifecycle controls.
 * @returns A handler preserving the original argument tuple and awaited result.
 *
 * @example
 * ```ts
 * import { defer } from '@use-crux/core'
 * import { withCrux } from '@use-crux/core/observability/workers'
 *
 * export default {
 *   fetch: withCrux(
 *     async (_request, _env, _ctx) => {
 *       defer(() => flushAnalytics())
 *       return new Response('ok')
 *     },
 *     { context: (_request, _env, ctx) => ctx },
 *   ),
 * }
 * ```
 */
export function withCrux<TArgs extends readonly unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: CruxWorkersOptions<TArgs, TResult>,
): (...args: TArgs) => Promise<Awaited<TResult>> {
  return (...args: TArgs): Promise<Awaited<TResult>> => {
    const context = options.context(...args);
    const invocation = options.invocation?.(context, ...args);
    const deferredHandler = withWaitUntilDefer(() => handler(...args), {
      waitUntil: (promise) =>
        context.waitUntil(drainAfterDeferredWork(promise, invocation)),
      ...(options.classifyOutcome
        ? { classifyOutcome: options.classifyOutcome }
        : {}),
      ...(options.durableFinalization !== undefined
        ? { durableFinalization: options.durableFinalization }
        : {}),
      ...(options.supportsInline !== undefined
        ? { supportsInline: options.supportsInline }
        : {}),
    });
    return deferredHandler();
  };
}

async function drainAfterDeferredWork(
  deferredWork: Promise<void>,
  invocation: CruxWorkersInvocation | undefined,
): Promise<void> {
  try {
    await deferredWork;
  } finally {
    // One retained host task owns the complete terminal sequence. This keeps
    // the drain ordered after defer's own evidence and flush without delaying
    // the handler result.
    await reportDrain(invocation);
  }
}

/**
 * Wrap a Workers-style handler so each invocation registers a bounded final
 * drain with `ctx.waitUntil()` before returning or rethrowing.
 *
 * `resolveInvocation` receives the same arguments as `handler` (typically
 * `(request, env, ctx)`) plus the resolved `ctx`, and returns this
 * invocation's drain knobs.
 */
export function withWorkersObservableInvocation<
  TArgs extends readonly unknown[],
  TResult,
>(
  handler: (...args: TArgs) => Promise<TResult>,
  resolveContext: (...args: TArgs) => CruxExecutionContext,
  resolveInvocation?: (
    ctx: CruxExecutionContext,
    ...args: TArgs
  ) => CruxWorkersInvocation | undefined,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const ctx = resolveContext(...args);
    const invocation = resolveInvocation?.(ctx, ...args);

    let outcome: { ok: true; value: TResult } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await handler(...args) };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // Registered after the handler settles either way, so a handler error is
    // never masked by a flush failure/throw, and `waitUntil` keeps the
    // isolate alive for the drain without delaying the returned response.
    ctx.waitUntil(reportDrain(invocation));

    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
}

async function reportDrain(
  invocation: CruxWorkersInvocation | undefined,
): Promise<void> {
  const report = invocation?.onDrain ?? warnAboutIncompleteDrain;
  let result: ObservabilityFlushResult;
  try {
    result = await observe.flush({
      timeoutMs: invocation?.flushTimeoutMs ?? DEFAULT_WORKERS_FLUSH_TIMEOUT_MS,
    });
  } catch (error) {
    result = failedDrainResult(error);
  }
  // A caller-supplied reporter is untrusted: isolate its failures so they
  // never mask the drain result or escape `waitUntil` as an unhandled
  // rejection that could be misattributed to a different concurrent request.
  try {
    const reporting = (report as (result: ObservabilityFlushResult) => unknown)(
      result,
    );
    void Promise.resolve(reporting).catch((error: unknown) => {
      console.error(
        "[crux] observability onDrain reporter rejected; the drain result above was still computed.",
        error,
      );
    });
  } catch (error) {
    console.error(
      "[crux] observability onDrain reporter threw; the drain result above was still computed.",
      error,
    );
  }
}

function failedDrainResult(error: unknown): ObservabilityFlushResult {
  const diagnostics = observabilityDiagnostics();
  console.error(
    "[crux] observability flush threw while draining a Workers invocation; treating as a failed drain.",
    error,
  );
  return {
    status: "failed",
    delivered: 0,
    rejected: 0,
    remaining: diagnostics.queuedRecords + diagnostics.pendingDeliveries,
    deadlineExceeded: false,
  };
}

function warnAboutIncompleteDrain(result: ObservabilityFlushResult): void {
  if (result.status === "drained") return;
  console.warn(
    "[crux] observability drain did not fully complete before the Workers invocation returned; telemetry may be delayed or lost.",
    result,
  );
}
