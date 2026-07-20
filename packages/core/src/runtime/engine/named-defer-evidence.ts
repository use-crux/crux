/**
 * Execution-time evidence for named request-scoped deferred work.
 *
 * Durable finalize creates plain `task.run` work. When that work carries
 * provider-neutral defer provenance, the Runtime execution boundary emits one
 * `defer.run` span grouped under the scheduled public evidence.
 *
 * @module
 */

import {
  observe,
  type CapturedObservabilityContext,
  type CruxRunId,
  type CruxSegmentId,
  type CruxSpanId,
  type CruxTraceId,
} from "../../observability";
import type { CruxDeploymentIdentity } from "../../project-index";
import type { JsonValue } from "../../storage";
import type { WorkItem } from "./work";

const NAMED_DEFER_OBSERVABILITY_FLUSH_TIMEOUT_MS = 3_000;

/** JSON-safe defer provenance persisted on intents and task.run work. */
export interface RuntimeNamedDeferProvenance {
  readonly mode: "named";
  readonly sequence: number;
  readonly scopeId: string;
  readonly workId: string;
  readonly targetId: string;
  readonly scheduledAtMs?: number;
  readonly operationId?: string;
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly traceId?: string;
  readonly segmentId?: string;
  readonly deployment?: CruxDeploymentIdentity;
  /** Durable acceptance-span identity used for the later causal edge. */
  readonly scheduledSpanId: string;
}

/** True when a JSON value looks like named defer provenance. */
export function isRuntimeNamedDeferProvenance(
  value: unknown,
): value is RuntimeNamedDeferProvenance {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.mode === "named" &&
    typeof record.sequence === "number" &&
    typeof record.scopeId === "string" &&
    typeof record.workId === "string" &&
    typeof record.targetId === "string" &&
    typeof record.scheduledSpanId === "string"
  );
}

/** Clone provenance into a plain JSON-safe object for durable storage. */
export function cloneNamedDeferProvenance(
  provenance: RuntimeNamedDeferProvenance,
): RuntimeNamedDeferProvenance {
  return Object.freeze({
    mode: "named" as const,
    sequence: provenance.sequence,
    scopeId: provenance.scopeId,
    workId: provenance.workId,
    targetId: provenance.targetId,
    ...(provenance.scheduledAtMs !== undefined
      ? { scheduledAtMs: provenance.scheduledAtMs }
      : {}),
    ...(provenance.operationId
      ? { operationId: provenance.operationId }
      : {}),
    ...(provenance.runId ? { runId: provenance.runId } : {}),
    ...(provenance.parentRunId
      ? { parentRunId: provenance.parentRunId }
      : {}),
    ...(provenance.traceId ? { traceId: provenance.traceId } : {}),
    ...(provenance.segmentId ? { segmentId: provenance.segmentId } : {}),
    ...(provenance.deployment ? { deployment: provenance.deployment } : {}),
    scheduledSpanId: provenance.scheduledSpanId,
  });
}

/** JSON-safe form suitable for intent/work rows. */
export function namedDeferProvenanceAsJson(
  provenance: RuntimeNamedDeferProvenance,
): JsonValue {
  return cloneNamedDeferProvenance(provenance) as unknown as JsonValue;
}

/**
 * Execute one target attempt under a `defer.run` span when work carries named
 * defer provenance. Ordinary task work is a pure pass-through.
 */
export async function executeWithNamedDeferEvidence<T>(
  work: WorkItem,
  execute: () => Promise<T>,
): Promise<T> {
  if (work.work.kind !== "task.run" || !work.work.defer) {
    return execute();
  }
  const provenance = work.work.defer;
  if (!isRuntimeNamedDeferProvenance(provenance)) {
    return execute();
  }

  const scheduledAtMs = provenance.scheduledAtMs ?? Date.now();
  const queueDelayMs = Math.max(0, Date.now() - scheduledAtMs);
  const scheduledSpanId = provenance.scheduledSpanId;

  const runOptions = {
    name: `defer named ${provenance.targetId}`,
    rootPrimitive: "defer.run" as const,
    attributes: {
      mode: "named",
      sequence: provenance.sequence,
      targetId: provenance.targetId,
      workId: provenance.workId,
      scopeId: provenance.scopeId,
      queueDelayMs,
    },
  };
  const parentContext = namedDeferParentContext(provenance, scheduledSpanId);
  const run = parentContext
    ? observe.openChildRun(parentContext, runOptions)
    : observe.openRun({
        ...runOptions,
        ...(provenance.traceId
          ? { traceId: provenance.traceId as CruxTraceId }
          : {}),
      });

  return run.withContext(async (): Promise<T> => {
    const span = observe.openSpan({
      name: `defer run named ${provenance.targetId}`,
      primitive: "defer.run",
      attributes: {
        mode: "named",
        sequence: provenance.sequence,
        targetId: provenance.targetId,
        workId: provenance.workId,
        scopeId: provenance.scopeId,
        queueDelayMs,
      },
      implicitRun: false,
    });

    observe.edge({
      edgeType: "triggered",
      from: { kind: "span", id: scheduledSpanId as CruxSpanId },
      to: { kind: "span", id: span.spanId },
    });

    let result: T;
    try {
      result = await span.withContext(execute);
    } catch (error) {
      span.end({
        status: "error",
        error,
        attributes: {
          mode: "named",
          sequence: provenance.sequence,
          targetId: provenance.targetId,
          workId: provenance.workId,
          scopeId: provenance.scopeId,
          queueDelayMs,
          outcome: "failed",
        },
      });
      run.error(error, {
        attributes: {
          mode: "named",
          sequence: provenance.sequence,
          targetId: provenance.targetId,
          workId: provenance.workId,
          scopeId: provenance.scopeId,
          queueDelayMs,
          outcome: "failed",
        },
      });
      throw error;
    }

    span.end({
      status: "ok",
      attributes: {
        mode: "named",
        sequence: provenance.sequence,
        targetId: provenance.targetId,
        workId: provenance.workId,
        scopeId: provenance.scopeId,
        queueDelayMs,
        outcome: "completed",
      },
    });
    run.end({
      status: "ok",
      attributes: {
        mode: "named",
        sequence: provenance.sequence,
        targetId: provenance.targetId,
        workId: provenance.workId,
        scopeId: provenance.scopeId,
        queueDelayMs,
        outcome: "completed",
      },
    });
    return result;
  }) as Promise<T>;
}

function namedDeferParentContext(
  provenance: RuntimeNamedDeferProvenance,
  scheduledSpanId: string,
): CapturedObservabilityContext | undefined {
  if (
    !isRunId(provenance.operationId) ||
    !isRunId(provenance.runId) ||
    !isTraceId(provenance.traceId) ||
    !isSegmentId(provenance.segmentId) ||
    !/^[0-9a-f]{16}$/u.test(scheduledSpanId) ||
    (provenance.parentRunId !== undefined &&
      !isRunId(provenance.parentRunId)) ||
    (provenance.parentRunId === undefined &&
      provenance.operationId !== provenance.runId) ||
    (provenance.parentRunId !== undefined &&
      (provenance.operationId === provenance.runId ||
        provenance.parentRunId === provenance.runId))
  ) {
    return undefined;
  }
  return {
    operationId: provenance.operationId as CruxRunId,
    runId: provenance.runId as CruxRunId,
    ...(provenance.parentRunId
      ? { parentRunId: provenance.parentRunId as CruxRunId }
      : {}),
    traceId: provenance.traceId as CruxTraceId,
    segmentId: provenance.segmentId as CruxSegmentId,
    ...(provenance.deployment ? { deployment: provenance.deployment } : {}),
    spanStack: [scheduledSpanId as CruxSpanId],
    currentSpanId: scheduledSpanId as CruxSpanId,
  };
}

function isRunId(value: string | undefined): value is string {
  return typeof value === "string" && /^run_[0-9a-f]{24}$/u.test(value);
}

function isSegmentId(value: string | undefined): value is string {
  return typeof value === "string" && /^seg_[0-9a-f]{24}$/u.test(value);
}

function isTraceId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{32}$/u.test(value) &&
    !/^0+$/u.test(value)
  );
}

/**
 * Deliver named wake evidence after the kernel has persisted its outcome.
 *
 * Ordinary work is a no-op. Delivery failure never replaces the authoritative
 * Runtime result, and the explicit deadline prevents a retained wake from
 * retrying indefinitely.
 */
export async function flushNamedDeferEvidenceAfterCommit(
  work: WorkItem,
): Promise<void> {
  if (
    work.work.kind !== "task.run" ||
    !isRuntimeNamedDeferProvenance(work.work.defer)
  ) {
    return;
  }
  try {
    await observe.flush({
      timeoutMs: NAMED_DEFER_OBSERVABILITY_FLUSH_TIMEOUT_MS,
    });
  } catch {
    // Delivery diagnostics retain the failure; persisted Runtime state is
    // authoritative and must never be replaced by an observability error.
  }
}
