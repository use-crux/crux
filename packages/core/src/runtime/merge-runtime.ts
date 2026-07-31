/**
 * Hook merge semantics for plugin composition.
 *
 * `mergeHooks()` folds a partial hook patch (typically a plugin's
 * `install()` result) into a base hook store. Hooks fan out (every handler is
 * called), middleware layers (new wraps old), safety policies concatenate, and
 * last-write-wins fields (observability transport/delivery) overwrite. The
 * private fan-out/chaining helpers live here so `plugin.ts` can stay focused on
 * the plugin contract and `applyPlugins()` orchestration.
 *
 * @module
 */

import type {
  CruxHooks,
  SpanActivationHook,
  TelemetryFlushHook,
  TelemetryResumeAttributesHook,
} from "./runtime";
import type {
  ResolveHook,
  ResolveHookArgs,
  StreamProgressReporter,
} from "./middleware";
import type { PromptMiddleware } from "./types";
import { finalizeMiddlewareResult } from "./internal/middleware-result-finalizer";
import { inheritCachedCandidateFinalizer } from "./internal/cached-candidate-finalizer";
import { inheritTerminalResultCoordinator } from "./internal/terminal-result-finalizer";

/**
 * Merge a partial hook patch into a base hook store.
 *
 * - **Hooks** (executionHook, resolveHook, streamStartHook): Fan-out — both
 *   base and patch handlers are called for every event.
 * - **Middleware**: Layered chaining — patch middleware wraps base middleware.
 * - **streamProgressHook**: Fan-out — both reporters receive chunks.
 * - **observability transport**: Last-write-wins.
 *
 * @param base - The current hook state.
 * @param patch - Partial fields to merge in.
 * @returns A new merged hook state (does not mutate inputs).
 *
 * @example
 * ```ts
 * const merged = mergeHooks(currentHooks, plugin.install(currentHooks))
 * ```
 */
export function mergeHooks(
  base: CruxHooks,
  patch: Partial<CruxHooks>,
): CruxHooks {
  const result: CruxHooks = { ...base };

  // Middleware: layered chaining (new wraps old)
  if (patch.middleware !== undefined) {
    result.middleware = chainMiddleware(base.middleware, patch.middleware);
  }

  // Fan-out hooks
  if (patch.executionHook !== undefined) {
    result.executionHook = fanOutHook(base.executionHook, patch.executionHook);
  }

  if (patch.resolveHook !== undefined) {
    result.resolveHook = fanOutResolveHook(base.resolveHook, patch.resolveHook);
  }

  if (patch.streamStartHook !== undefined) {
    result.streamStartHook = fanOutHook(
      base.streamStartHook,
      patch.streamStartHook,
    );
  }

  if (patch.streamProgressHook !== undefined) {
    result.streamProgressHook = fanOutStreamProgressHook(
      base.streamProgressHook,
      patch.streamProgressHook,
    );
  }

  // Span activation: layered chaining (new activates around old, innermost fn last)
  if (patch.spanActivationHook !== undefined) {
    result.spanActivationHook = chainSpanActivationHook(
      base.spanActivationHook,
      patch.spanActivationHook,
    );
  }

  // Telemetry flush: fan-out — every installed manager's flush is awaited, all must succeed for `ok`.
  if (patch.telemetryFlushHook !== undefined) {
    result.telemetryFlushHook = fanOutTelemetryFlushHook(
      base.telemetryFlushHook,
      patch.telemetryFlushHook,
    );
  }

  // Resume attributes: fan-out — attribute objects from every plugin are merged, patch wins on key conflicts.
  if (patch.telemetryResumeAttributesHook !== undefined) {
    result.telemetryResumeAttributesHook = fanOutResumeAttributesHook(
      base.telemetryResumeAttributesHook,
      patch.telemetryResumeAttributesHook,
    );
  }

  // Global safety policies: concat so multiple plugins compose
  if (patch.globalConstraints !== undefined) {
    result.globalConstraints = [
      ...(base.globalConstraints ?? []),
      ...patch.globalConstraints,
    ];
  }

  if (patch.globalGuardrails !== undefined) {
    result.globalGuardrails = [
      ...(base.globalGuardrails ?? []),
      ...patch.globalGuardrails,
    ];
  }

  if ("observabilityTransport" in patch) {
    result.observabilityTransport = patch.observabilityTransport;
  }

  if ("projectIndexRuntimeTransport" in patch) {
    result.projectIndexRuntimeTransport = patch.projectIndexRuntimeTransport;
  }

  if ("observabilityDelivery" in patch) {
    result.observabilityDelivery = patch.observabilityDelivery;
  }

  if ("semanticCacheInstalled" in patch) {
    result.semanticCacheInstalled = patch.semanticCacheInstalled;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Chain middleware: new wraps old (layered).
 * When the new middleware calls `next(args)`, it invokes the old middleware.
 */
function chainMiddleware(
  base: PromptMiddleware | undefined,
  patch: PromptMiddleware,
): PromptMiddleware {
  if (!base) return patch;
  return async (args, next) => {
    const innerNext = inheritTerminalResultCoordinator(
      next,
      inheritCachedCandidateFinalizer(
        next,
        async (innerArgs) =>
          finalizeMiddlewareResult(next, await base(innerArgs, next)),
      ),
    );
    return patch(args, innerNext);
  };
}

/**
 * Fan-out two hooks: both called with the same args.
 * Works for any hook with signature `(args) => void | Promise<void>`.
 */
function fanOutHook<T extends (...args: never[]) => unknown>(
  base: T | undefined,
  patch: T,
): T {
  if (!base) return patch;
  return ((...args: Parameters<T>) => {
    base(...args);
    return patch(...args);
  }) as T;
}

/**
 * Fan-out resolve hooks: both called, last result wins.
 * ResolveHook returns a traceId that needs to propagate.
 */
function fanOutResolveHook(
  base: ResolveHook | undefined,
  patch: ResolveHook,
): ResolveHook {
  if (!base) return patch;
  return async (args: ResolveHookArgs) => {
    await base(args);
    return patch(args);
  };
}

/**
 * Chain span activation hooks: patch activates around a callback that itself
 * runs the base activation, so both stay active for the real work.
 */
function chainSpanActivationHook(
  base: SpanActivationHook | undefined,
  patch: SpanActivationHook,
): SpanActivationHook {
  if (!base) return patch;
  return (context, fn) => patch(context, () => base(context, fn));
}

/**
 * Fan-out telemetry flush hooks: both flushed concurrently with the same
 * bound, combined into one non-throwing result.
 */
function fanOutTelemetryFlushHook(
  base: TelemetryFlushHook | undefined,
  patch: TelemetryFlushHook,
): TelemetryFlushHook {
  if (!base) return patch;
  return async (options) => {
    const [a, b] = await Promise.all([base(options), patch(options)]);
    return {
      ok: a.ok && b.ok,
      timedOut: Boolean(a.timedOut) || Boolean(b.timedOut),
    };
  };
}

/**
 * Fan-out resume-attribute hooks: attribute objects from every plugin are
 * merged, with the later-installed (patch) plugin winning on key conflicts.
 */
function fanOutResumeAttributesHook(
  base: TelemetryResumeAttributesHook | undefined,
  patch: TelemetryResumeAttributesHook,
): TelemetryResumeAttributesHook {
  if (!base) return patch;
  return (carrier) => ({ ...(base(carrier) ?? {}), ...(patch(carrier) ?? {}) });
}

/**
 * Fan-out stream progress hooks: both reporters created, onChunk/flush/dispose
 * forwarded to both.
 */
function fanOutStreamProgressHook(
  base: CruxHooks["streamProgressHook"],
  patch: NonNullable<CruxHooks["streamProgressHook"]>,
): NonNullable<CruxHooks["streamProgressHook"]> {
  if (!base) return patch;
  return (traceId: string): StreamProgressReporter | undefined => {
    const r1 = base(traceId);
    const r2 = patch(traceId);
    if (!r1 && !r2) return undefined;
    return {
      onChunk(textDelta) {
        r1?.onChunk(textDelta);
        r2?.onChunk(textDelta);
      },
      async flush() {
        await r1?.flush();
        await r2?.flush();
      },
      dispose() {
        r1?.dispose();
        r2?.dispose();
      },
    };
  };
}
