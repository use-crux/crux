/** Safe public status events backed by the Runtime durable event port. */

import type { JsonObject, JsonValue } from "../../storage";
import type { StatisticsFact } from "../../statistics";
import type { RuntimeStoreTransaction } from "../store";
import type { RuntimeWorkItem } from "./work";
import { recordApplicationWorkTransition } from "./application-work-statistics";

/** Append one deduplicable safe status event and retain its newest cursor. */
export async function appendApplicationWorkStatusEvent(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
): Promise<RuntimeWorkItem> {
  if (!work.application) return work;
  const event = await tx.events.append({
    namespace: work.namespace,
    name: `crux.work:${work.workId}`,
    payload: statusEventPayload(work),
  });
  return Object.freeze({
    ...work,
    application: Object.freeze({
      ...work.application,
      latestEventCursor: event.eventId,
    }),
  });
}

/** Persist one suspended-to-pending resumption and its safe status event. */
export async function recordApplicationWorkResumption(
  tx: RuntimeStoreTransaction,
  previous: RuntimeWorkItem,
  pending: RuntimeWorkItem,
  at: Date,
): Promise<RuntimeWorkItem> {
  return await recordApplicationWorkStatusTransition(
    tx,
    previous,
    pending,
    at,
    [{ kind: "lifecycle", event: "resumption" }],
  );
}

/** Persist a lifecycle transition and its safe public status event. */
export async function recordApplicationWorkStatusTransition(
  tx: RuntimeStoreTransaction,
  previous: RuntimeWorkItem,
  next: RuntimeWorkItem,
  at: Date,
  facts: readonly StatisticsFact[] = [],
): Promise<RuntimeWorkItem> {
  const transitioned = await appendApplicationWorkStatusEvent(
    tx,
    recordApplicationWorkTransition(previous, next, at, { facts }),
  );
  await tx.state.putWork(transitioned);
  return transitioned;
}

function statusEventPayload(work: RuntimeWorkItem): JsonValue {
  return {
    schemaVersion: 1,
    type: "work.status",
    workId: work.workId,
    status: safeStatusValue(work),
  };
}

function safeStatusValue(work: RuntimeWorkItem): JsonValue {
  const application = work.application!;
  const ownership: JsonObject =
    application.ownership.state === "detached"
      ? {
          state: "detached",
          reason: application.ownership.reason,
          detachedAt: application.ownership.detachedAt,
        }
      : { state: "attached" };
  const progress: JsonObject | undefined = application.progress
    ? {
        ...(application.progress.message === undefined
          ? {}
          : { message: application.progress.message }),
        ...(application.progress.current === undefined
          ? {}
          : { current: application.progress.current }),
        ...(application.progress.total === undefined
          ? {}
          : { total: application.progress.total }),
        updatedAt: application.progress.updatedAt,
      }
    : undefined;
  const base: JsonObject = {
    id: work.workId,
    ...(progress ? { progress } : {}),
    ownership,
    updatedAt: application.updatedAt,
  };
  switch (work.status) {
    case "pending":
      return {
        ...base,
        state: "queued",
        acceptedAt: work.createdAt.toISOString(),
      };
    case "leased":
      return {
        ...base,
        state: "running",
        startedAt: application.startedAt ?? work.updatedAt.toISOString(),
      };
    case "suspended":
      return { ...base, state: "suspended", suspendedOn: { kind: "other" } };
    case "blocked":
      return {
        ...base,
        state: "blocked",
        blockedOn: {
          kind: "other",
          code: work.lastError?.code ?? "work_blocked",
          message: work.lastError?.message ?? "Work is blocked.",
        },
      };
    case "completed":
      return {
        ...base,
        state: "completed",
        completedAt: work.updatedAt.toISOString(),
        resultAvailable: work.resultRef !== undefined,
      };
    case "dead-letter":
      return {
        ...base,
        state: "failed",
        failedAt: work.updatedAt.toISOString(),
        failure: {
          code: work.lastError?.code ?? "work_failed",
          message: work.lastError?.message ?? "Work failed.",
          retryable: false,
        },
      };
    case "cancelled":
      return {
        ...base,
        state: "cancelled",
        cancelledAt: work.updatedAt.toISOString(),
        ...(application.cancellationReason
          ? { reason: application.cancellationReason }
          : {}),
      };
  }
}
