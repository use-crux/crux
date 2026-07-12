/**
 * Public and diagnostics-only evidence policy for request-scoped `defer()`.
 *
 * Public registrations emit `defer.scheduled` / `defer.run` with a causal
 * `triggered` edge. When no originating Crux run exists, one lightweight
 * grouped run is opened for the invocation scope. The diagnostics-only
 * composition port creates no Catalog noise and no user Run or deferred spans.
 *
 * @module
 */

import {
  observe,
  type CapturedObservabilityContext,
  type CruxSpanId,
  type OpenObservedRun,
  type OpenObservedSpan,
} from "../../observability";
import type { DeferCompletionClass } from "../host-types";
import type { DeferredDrainResult } from "./invocation-scope";

/** Whether a registration is user-authored or first-party internal composition. */
export type DeferEvidencePolicy = "public" | "diagnostics-only";

/** Handle retained so execution can open a causally linked `defer.run` span. */
export interface DeferredScheduledObservation {
  readonly policy: DeferEvidencePolicy;
  readonly sequence: number;
  readonly mode: "inline" | "named";
  readonly completion: DeferCompletionClass;
  readonly scheduledAtMs: number;
  readonly spanId?: CruxSpanId;
  readonly context?: CapturedObservabilityContext;
}

interface CreateDeferScopeObservabilityOptions {
  readonly completion: DeferCompletionClass;
}

/** Per-invocation evidence controller shared by registration and drain. */
export interface DeferScopeObservability {
  /**
   * Record that one public or diagnostics-only inline callback was accepted.
   *
   * Public policy emits an instantaneous `defer.scheduled` span. Diagnostics-only
   * policy records sequencing metadata without graph emission.
   */
  recordInlineScheduled(
    sequence: number,
    policy: DeferEvidencePolicy,
  ): DeferredScheduledObservation;

  /**
   * Record durable named acceptance for one staged target.
   *
   * The scheduled span stays open until {@link markNamedTerminal} so intent
   * state transitions remain visible as a single unit of work.
   */
  recordNamedScheduled(input: {
    readonly sequence: number;
    readonly policy: DeferEvidencePolicy;
    readonly targetId: string;
    readonly workId: string;
    readonly scopeId?: string;
    readonly definitionId?: string;
  }): DeferredScheduledObservation & { readonly openSpan?: OpenObservedSpan };

  /** Close a named scheduled span with its terminal durable state. */
  markNamedTerminal(
    observation: DeferredScheduledObservation & {
      readonly openSpan?: OpenObservedSpan;
    },
    intentState: "released" | "abandoned",
    status?: "ok" | "cancelled" | "error",
  ): void;

  /**
   * Execute one callback under a `defer.run` span causally linked to its
   * scheduled observation.
   */
  runInline(
    observation: DeferredScheduledObservation,
    execute: () => Promise<void>,
  ): Promise<void>;

  /**
   * End the optional grouped run once drain settlement is known.
   *
   * Safe to call when the invocation inherited an external run — in that case
   * this is a no-op.
   */
  settle(result: DeferredDrainResult): void;
}

/**
 * Create the evidence controller for one invocation scope.
 *
 * The controller is lazy: no run is opened until the first public registration.
 */
export function createDeferScopeObservability(
  options: CreateDeferScopeObservabilityOptions,
): DeferScopeObservability {
  let groupedRun: OpenObservedRun | undefined;
  let ownedGroupedRun = false;
  let baseContext: CapturedObservabilityContext | undefined;
  const openNamed = new Map<number, OpenObservedSpan>();

  function ensurePublicContext(): CapturedObservabilityContext {
    if (baseContext) return baseContext;

    const current = observe.captureContext();
    if (current) {
      baseContext = {
        runId: current.runId,
        traceId: current.traceId,
        ...(current.startedAtMs !== undefined
          ? { startedAtMs: current.startedAtMs }
          : {}),
        ...(current.correlators !== undefined
          ? { correlators: current.correlators }
          : {}),
        // Capture the active parent stack for scheduled emission, but keep the
        // run identity for later causal execution that must not nest under a
        // closed response span.
        spanStack: [...current.spanStack],
        ...(current.currentSpanId
          ? { currentSpanId: current.currentSpanId }
          : {}),
      };
      return baseContext;
    }

    groupedRun = observe.openRun({
      name: "deferred work",
      rootPrimitive: "defer.scheduled",
      attributes: {
        completion: options.completion,
      },
    });
    ownedGroupedRun = true;
    baseContext = groupedRun.captureContext();
    return baseContext;
  }

  function withPublicContext<T>(
    context: CapturedObservabilityContext,
    fn: () => T,
  ): T {
    return observe.withContext(context, fn) as T;
  }

  const api: DeferScopeObservability = {
    recordInlineScheduled(sequence, policy) {
      const scheduledAtMs = Date.now();
      if (policy === "diagnostics-only") {
        return {
          policy,
          sequence,
          mode: "inline",
          completion: options.completion,
          scheduledAtMs,
        };
      }

      const context = ensurePublicContext();
      let spanId: CruxSpanId | undefined;
      withPublicContext(context, () => {
        const span = observe.openSpan({
          name: `defer inline #${sequence}`,
          primitive: "defer.scheduled",
          attributes: {
            mode: "inline",
            completion: options.completion,
            sequence,
          },
        });
        spanId = span.spanId;
        span.end({
          status: "ok",
          attributes: {
            mode: "inline",
            completion: options.completion,
            sequence,
          },
        });
      });

      return {
        policy,
        sequence,
        mode: "inline",
        completion: options.completion,
        scheduledAtMs,
        spanId,
        context: {
          runId: context.runId,
          traceId: context.traceId,
          ...(context.startedAtMs !== undefined
            ? { startedAtMs: context.startedAtMs }
            : {}),
          ...(context.correlators !== undefined
            ? { correlators: context.correlators }
            : {}),
          // Empty stack: execution uses a causal edge, not temporal nesting.
          spanStack: [],
        },
      };
    },

    recordNamedScheduled(input) {
      const scheduledAtMs = Date.now();
      if (input.policy === "diagnostics-only") {
        return {
          policy: input.policy,
          sequence: input.sequence,
          mode: "named",
          completion: options.completion,
          scheduledAtMs,
        };
      }

      const context = ensurePublicContext();
      let openSpan: OpenObservedSpan | undefined;
      withPublicContext(context, () => {
        openSpan = observe.openSpan({
          name: `defer named ${input.targetId}`,
          primitive: "defer.scheduled",
          attributes: {
            mode: "named",
            completion: options.completion,
            sequence: input.sequence,
            targetId: input.targetId,
            workId: input.workId,
            intentState: "staged",
            ...(input.scopeId ? { scopeId: input.scopeId } : {}),
            ...(input.definitionId
              ? { definitionId: input.definitionId }
              : {}),
          },
        });
        openNamed.set(input.sequence, openSpan);
      });

      return {
        policy: input.policy,
        sequence: input.sequence,
        mode: "named",
        completion: options.completion,
        scheduledAtMs,
        spanId: openSpan?.spanId,
        openSpan,
        context: {
          runId: context.runId,
          traceId: context.traceId,
          ...(context.startedAtMs !== undefined
            ? { startedAtMs: context.startedAtMs }
            : {}),
          ...(context.correlators !== undefined
            ? { correlators: context.correlators }
            : {}),
          spanStack: [],
        },
      };
    },

    markNamedTerminal(observation, intentState, status = "ok") {
      const span = observation.openSpan ?? openNamed.get(observation.sequence);
      if (!span) return;
      openNamed.delete(observation.sequence);
      span.end({
        status: intentState === "abandoned" ? (status === "ok" ? "cancelled" : status) : status,
        attributes: {
          mode: "named",
          completion: observation.completion,
          sequence: observation.sequence,
          intentState,
        },
      });
    },

    async runInline(observation, execute) {
      if (observation.policy === "diagnostics-only") {
        try {
          await execute();
        } catch (error) {
          emitInternalFailure(error);
          throw error;
        }
        return;
      }

      const context = observation.context ?? ensurePublicContext();
      const queueDelayMs = Math.max(0, Date.now() - observation.scheduledAtMs);
      const runContext: CapturedObservabilityContext = {
        runId: context.runId,
        traceId: context.traceId,
        ...(context.startedAtMs !== undefined
          ? { startedAtMs: context.startedAtMs }
          : {}),
        ...(context.correlators !== undefined
          ? { correlators: context.correlators }
          : {}),
        spanStack: [],
      };

      await observe.withContext(runContext, async () => {
        const span = observe.openSpan({
          name: `defer run #${observation.sequence}`,
          primitive: "defer.run",
          attributes: {
            mode: observation.mode,
            completion: observation.completion,
            sequence: observation.sequence,
            queueDelayMs,
          },
          // Execution must not open a second root when the grouped/parent run
          // already exists in the restored context.
          implicitRun: false,
        });

        if (observation.spanId) {
          observe.edge({
            edgeType: "triggered",
            from: { kind: "span", id: observation.spanId },
            to: { kind: "span", id: span.spanId },
          });
        }

        try {
          await span.withContext(execute);
          span.end({
            status: "ok",
            attributes: {
              mode: observation.mode,
              completion: observation.completion,
              sequence: observation.sequence,
              queueDelayMs,
              outcome: "completed",
            },
          });
        } catch (error) {
          span.end({
            status: "error",
            error,
            attributes: {
              mode: observation.mode,
              completion: observation.completion,
              sequence: observation.sequence,
              queueDelayMs,
              outcome: "failed",
            },
          });
          throw error;
        }
      });
    },

    settle(result) {
      for (const span of openNamed.values()) {
        span.end({
          status: "cancelled",
          attributes: {
            mode: "named",
            completion: options.completion,
            sequence: -1,
            intentState: "abandoned",
          },
        });
      }
      openNamed.clear();

      if (!ownedGroupedRun || !groupedRun) return;
      const status = result.timedOut
        ? "cancelled"
        : result.cancelled
          ? "cancelled"
          : result.callbacks.some((callback) => callback.outcome === "failed")
            ? "error"
            : "ok";
      groupedRun.end({ status });
      ownedGroupedRun = false;
      groupedRun = undefined;
    },
  };

  return api;
}

/**
 * Attach one bounded failure event to the owning primitive when internal
 * composition fails. Never opens a deferred-work run or Catalog definition.
 */
function emitInternalFailure(error: unknown): void {
  const context = observe.captureContext();
  if (!context?.currentSpanId && (context?.spanStack.length ?? 0) === 0) {
    return;
  }
  observe.event({
    name: "defer.internal.failed",
    attributes: {
      message:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Internal deferred callback failed.",
    },
  });
}
