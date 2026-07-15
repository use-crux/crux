/**
 * Generic serverless invocation wrapper for observability delivery.
 *
 * Framework-neutral: no Node, Workers, or Convex imports. A physical
 * invocation binds its own {@link CruxHostLifecycle} (scoped, not global) and
 * performs a bounded final `observe.flush()` before returning, so telemetry
 * from a completed invocation is not silently dropped when the process
 * suspends or is recycled.
 *
 * The wrapper preserves `handler`'s own return type and never wraps it in an
 * envelope; the drain outcome is reported through {@link CruxServerlessInvocation.onDrain}
 * instead, so a caller that ignores it still gets a console warning rather
 * than a silently discarded partial delivery.
 *
 * @module
 */

import { observabilityDiagnostics, observe } from "./observe";
import type { ObservabilityFlushResult } from "./delivery/options";
import {
  remainingHostDeadlineMs,
  type CruxHostLifecycle,
} from "../runtime/api/host-lifecycle";

/** Per-invocation lifetime knobs a host adapter resolves for one physical invocation. */
export interface CruxServerlessInvocation {
  /** Absolute epoch-ms deadline for this invocation, when the host exposes one. */
  readonly deadlineMs?: number;
  /** Remaining time in ms from now, when only a relative budget is known. */
  readonly remainingTimeMs?: number;
  /** Time reserved before the deadline for the final flush. @default 0 */
  readonly flushSafetyMarginMs?: number;
  /** Explicit bound for the final flush, overriding the derived host deadline. */
  readonly flushTimeoutMs?: number;
  /**
   * Receives this invocation's final drain result, whether or not the
   * handler itself threw.
   *
   * Omit to fall back to a console warning whenever the drain does not fully
   * complete (`status !== 'drained'`); the drain result is never silently
   * discarded either way.
   */
  readonly onDrain?: (result: ObservabilityFlushResult) => void;
}

/**
 * Wrap a handler so each call binds its own scoped host lifecycle and
 * performs a bounded final flush before returning or rethrowing.
 *
 * `resolveInvocation` receives the same arguments as `handler` and returns
 * this invocation's lifetime knobs; omit it to flush without a deadline
 * bound (still bounded by delivery's own retry/error backstops).
 */
export function withObservableInvocation<
  TArgs extends readonly unknown[],
  TResult,
>(
  handler: (...args: TArgs) => Promise<TResult>,
  resolveInvocation?: (...args: TArgs) => CruxServerlessInvocation | undefined,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const invocation = resolveInvocation?.(...args);
    // Snapshot one absolute deadline now. `remainingTimeMs` is relative to
    // invocation start; re-deriving it from `Date.now()` on every read (e.g.
    // once for `withHostLifecycle`, again on drain) would push the deadline
    // out with every call and never truthfully expire.
    const deadlineMs = resolveDeadlineMs(invocation);
    const deferred: Promise<void>[] = [];
    const lifecycle: CruxHostLifecycle = {
      defer: (task) => deferred.push(task),
      deadline: () => deadlineMs,
    };

    let outcome: { ok: true; value: TResult } | { ok: false; error: unknown };
    try {
      outcome = {
        ok: true,
        value: await observe.withHostLifecycle(lifecycle, () =>
          handler(...args),
        ),
      };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // Drained after the handler settles either way, so a handler error is
    // never masked by a flush failure/throw (see `reportDrain`) and the
    // drain result is never left unreported.
    await reportDrain(invocation, lifecycle);

    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
}

async function reportDrain(
  invocation: CruxServerlessInvocation | undefined,
  lifecycle: CruxHostLifecycle,
): Promise<void> {
  const report = invocation?.onDrain ?? warnAboutIncompleteDrain;
  const flushTimeoutMs =
    invocation?.flushTimeoutMs ??
    remainingHostDeadlineMs(lifecycle, {
      safetyMarginMs: invocation?.flushSafetyMarginMs ?? 0,
    });
  let result: ObservabilityFlushResult;
  try {
    result = await observe.flush(
      flushTimeoutMs === undefined ? {} : { timeoutMs: flushTimeoutMs },
    );
  } catch (error) {
    result = failedDrainResult(error);
  }
  // A caller-supplied reporter is untrusted: it must never mask the
  // handler's own outcome the way a throwing `finally` block would.
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
    "[crux] observability flush threw while draining a serverless invocation; treating as a failed drain.",
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
    "[crux] observability drain did not fully complete before the serverless invocation returned; telemetry may be delayed or lost.",
    result,
  );
}

function resolveDeadlineMs(
  invocation: CruxServerlessInvocation | undefined,
): number | undefined {
  if (invocation?.deadlineMs !== undefined) return invocation.deadlineMs;
  if (invocation?.remainingTimeMs !== undefined)
    return Date.now() + invocation.remainingTimeMs;
  return undefined;
}
