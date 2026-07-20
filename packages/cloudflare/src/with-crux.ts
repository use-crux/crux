import {
  observabilityDiagnostics,
  observe,
  type ObservabilityFlushResult,
} from "@use-crux/core/observability";
import {
  withWaitUntilDefer,
  type ServerlessDeferClassifyOutcome,
} from "@use-crux/core/defer/serverless";
import { onDeferDrainSettled } from "@use-crux/core/internal/scope";
import type { WorkersExecutionContext } from "./workers";

const DEFAULT_WORKERS_FLUSH_TIMEOUT_MS = 5_000;

/** Per-invocation controls for the final Workers observability drain. */
export interface CruxWorkersInvocation {
  /**
   * Maximum time allowed for the final drain.
   *
   * Workers exposes no remaining-time API, so Crux uses five seconds unless
   * this value is provided.
   */
  readonly flushTimeoutMs?: number;
  /** Receives the structured result of this invocation's final drain. */
  readonly onDrain?: (result: ObservabilityFlushResult) => void;
}

/** Options for the canonical Cloudflare Workers invocation boundary. */
export interface CruxWorkersOptions<TArgs extends readonly unknown[], TResult> {
  /** Resolve the structural Workers execution context for this call. */
  readonly context: (...args: TArgs) => WorkersExecutionContext;
  /** Resolve optional per-invocation observability drain controls. */
  readonly invocation?: (
    context: WorkersExecutionContext,
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
 * The returned handler settles without waiting for retained work. One
 * `ExecutionContext.waitUntil()` task owns deferred callbacks, evidence, the
 * structured wrapper drain, and the kernel's final observability flush.
 *
 * @param handler - Workers handler to invoke.
 * @param options - Per-call context resolution and lifecycle controls.
 * @returns A handler preserving the original argument tuple and awaited result.
 *
 * @example
 * ```ts
 * import { defer } from '@use-crux/core'
 * import { withCrux } from '@use-crux/cloudflare'
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
    const deferredHandler = withWaitUntilDefer(
      () => {
        onDeferDrainSettled(() => reportDrain(invocation));
        return handler(...args);
      },
      {
        waitUntil: (promise) => context.waitUntil(promise),
        ...(options.classifyOutcome
          ? { classifyOutcome: options.classifyOutcome }
          : {}),
        ...(options.durableFinalization !== undefined
          ? { durableFinalization: options.durableFinalization }
          : {}),
        ...(options.supportsInline !== undefined
          ? { supportsInline: options.supportsInline }
          : {}),
      },
    );
    return deferredHandler();
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
