/** Safe public status projection for durable Runtime Work records. */

import type { JsonValue } from "../../storage";
import type { RuntimeWorkItem } from "../../runtime/engine/work";
import type { WorkProgressSnapshot } from "../progress";
import type { WorkOwnership, WorkStatus } from "../status";

/** Project one canonical Runtime Work row into a result-free public status. */
export function durableWorkStatus(work: RuntimeWorkItem): WorkStatus {
  const application = work.application;
  const base = Object.freeze({
    id: work.workId,
    ...(application?.progress
      ? { progress: progressSnapshot(application.progress) }
      : {}),
    ownership:
      application?.ownership.state === "detached"
        ? Object.freeze({
            ...application.ownership,
            detachedAt: new Date(application.ownership.detachedAt),
          })
        : Object.freeze({ state: "attached" as const }),
    updatedAt: new Date(application?.updatedAt ?? work.updatedAt),
  });
  switch (work.status) {
    case "pending":
      return Object.freeze({
        ...base,
        state: "queued",
        acceptedAt: new Date(work.createdAt),
      });
    case "leased":
      return Object.freeze({
        ...base,
        state: "running",
        startedAt: new Date(application?.startedAt ?? work.updatedAt),
      });
    case "suspended":
      return Object.freeze({
        ...base,
        state: "suspended",
        suspendedOn: Object.freeze({ kind: "other" }),
      });
    case "blocked":
      return Object.freeze({
        ...base,
        state: "blocked",
        blockedOn: Object.freeze({
          kind: "other",
          code: work.lastError?.code ?? "work_blocked",
          message: work.lastError?.message ?? "Work is blocked.",
        }),
      });
    case "dead-letter":
      return Object.freeze({
        ...base,
        state: "failed",
        failedAt: new Date(work.updatedAt),
        failure: Object.freeze({
          code: work.lastError?.code ?? "work_failed",
          message: work.lastError?.message ?? "Work failed.",
          retryable: false,
        }),
      });
    case "completed":
      return Object.freeze({
        ...base,
        state: "completed",
        completedAt: new Date(work.updatedAt),
        resultAvailable: work.resultRef !== undefined,
      });
    case "cancelled":
      return Object.freeze({
        ...base,
        state: "cancelled",
        cancelledAt: new Date(work.updatedAt),
        ...(application?.cancellationReason
          ? { reason: application.cancellationReason }
          : {}),
      });
  }
}

/** Decode one safe status value read from the durable event port. */
export function decodeDurableWorkStatus(
  value: JsonValue,
): WorkStatus | undefined {
  const status = record(value);
  if (
    !status ||
    typeof status.id !== "string" ||
    typeof status.state !== "string"
  )
    return undefined;
  const updatedAt = date(status.updatedAt);
  const ownership = decodeOwnership(status.ownership);
  if (!updatedAt || !ownership) return undefined;
  const progress = decodeProgress(status.progress);
  const base = {
    id: status.id,
    ...(progress ? { progress } : {}),
    ownership,
    updatedAt,
  };
  switch (status.state) {
    case "queued": {
      const acceptedAt = date(status.acceptedAt);
      return acceptedAt
        ? Object.freeze({ ...base, state: "queued", acceptedAt })
        : undefined;
    }
    case "running": {
      const startedAt = date(status.startedAt);
      return startedAt
        ? Object.freeze({ ...base, state: "running", startedAt })
        : undefined;
    }
    case "suspended":
      return Object.freeze({
        ...base,
        state: "suspended",
        suspendedOn: { kind: "other" as const },
      });
    case "blocked": {
      const blocked = record(status.blockedOn);
      return blocked &&
        typeof blocked.code === "string" &&
        typeof blocked.message === "string"
        ? Object.freeze({
            ...base,
            state: "blocked",
            blockedOn: {
              kind: "other" as const,
              code: blocked.code,
              message: blocked.message,
            },
          })
        : undefined;
    }
    case "completed": {
      const completedAt = date(status.completedAt);
      return completedAt && typeof status.resultAvailable === "boolean"
        ? Object.freeze({
            ...base,
            state: "completed",
            completedAt,
            resultAvailable: status.resultAvailable,
          })
        : undefined;
    }
    case "failed": {
      const failedAt = date(status.failedAt);
      const failure = record(status.failure);
      return failedAt &&
        failure &&
        typeof failure.code === "string" &&
        typeof failure.message === "string" &&
        typeof failure.retryable === "boolean"
        ? Object.freeze({
            ...base,
            state: "failed",
            failedAt,
            failure: {
              code: failure.code,
              message: failure.message,
              retryable: failure.retryable,
            },
          })
        : undefined;
    }
    case "cancelled": {
      const cancelledAt = date(status.cancelledAt);
      return cancelledAt &&
        (status.reason === undefined || typeof status.reason === "string")
        ? Object.freeze({
            ...base,
            state: "cancelled",
            cancelledAt,
            ...(status.reason ? { reason: status.reason } : {}),
          })
        : undefined;
    }
    default:
      return undefined;
  }
}

function progressSnapshot(value: {
  readonly message?: string;
  readonly current?: number;
  readonly total?: number;
  readonly updatedAt: string;
}): WorkProgressSnapshot {
  return Object.freeze({
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.current === undefined ? {} : { current: value.current }),
    ...(value.total === undefined ? {} : { total: value.total }),
    updatedAt: new Date(value.updatedAt),
  });
}

function decodeProgress(
  value: JsonValue | undefined,
): WorkProgressSnapshot | undefined {
  if (value === undefined) return undefined;
  const progress = record(value);
  const updatedAt = progress ? date(progress.updatedAt) : undefined;
  if (!progress || !updatedAt) return undefined;
  if (progress.message !== undefined && typeof progress.message !== "string")
    return undefined;
  if (progress.current !== undefined && typeof progress.current !== "number")
    return undefined;
  if (progress.total !== undefined && typeof progress.total !== "number")
    return undefined;
  return Object.freeze({
    ...(progress.message === undefined ? {} : { message: progress.message }),
    ...(progress.current === undefined ? {} : { current: progress.current }),
    ...(progress.total === undefined ? {} : { total: progress.total }),
    updatedAt,
  });
}

function decodeOwnership(
  value: JsonValue | undefined,
): WorkOwnership | undefined {
  const ownership = value === undefined ? undefined : record(value);
  if (ownership?.state === "attached")
    return Object.freeze({ state: "attached" });
  const detachedAt =
    ownership?.state === "detached" ? date(ownership.detachedAt) : undefined;
  return detachedAt &&
    (ownership?.reason === "explicit" || ownership?.reason === "owner-ended")
    ? Object.freeze({ state: "detached", reason: ownership.reason, detachedAt })
    : undefined;
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue | undefined> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue | undefined>)
    : undefined;
}

function date(value: JsonValue | undefined): Date | undefined {
  if (typeof value !== "string") return undefined;
  const decoded = new Date(value);
  return Number.isFinite(decoded.getTime()) ? decoded : undefined;
}
