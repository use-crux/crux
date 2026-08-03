/** Cursor-backed Work event streaming over the Runtime durable event port. */

import type { JsonValue } from "../../storage";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import type { RuntimeEvent } from "../../runtime/ports/events";
import type { EventCursor, WorkId } from "../../runtime/ports/ids";
import type { WorkEvent, WorkStreamOptions } from "../events";
import type { WorkProgressSnapshot } from "../progress";
import { decodeDurableWorkStatus, durableWorkStatus } from "./durable-status";
import { waitForDurableWorkChange } from "./durable-wait";
import { retainedWorkMissing } from "./durable-errors";

/** Yield a replacement snapshot followed by safe events until terminal state. */
export async function* durableWorkStream(
  runtime: ResolvedRuntimeEngine,
  id: WorkId,
  options: WorkStreamOptions = {},
): AsyncIterable<WorkEvent> {
  let cursor = options.after as EventCursor | undefined;
  let validateCursor = options.after !== undefined;
  if (!cursor) {
    const current = await requireWork(runtime, id);
    const status = durableWorkStatus(current);
    cursor = current.application?.latestEventCursor as EventCursor | undefined;
    yield snapshotEvent(id, current, status, cursor);
    if (isTerminal(status.state)) return;
  }

  let waitAttempt = 0;
  for (;;) {
    let page = await runtime.store.events.read({
      namespace: runtime.namespace,
      name: `crux.work:${id}`,
      ...(cursor ? { after: cursor } : {}),
      limit: 100,
    });
    if (validateCursor) {
      validateCursor = false;
      if (page.afterFound === false) {
        const current = await requireWork(runtime, id);
        const status = durableWorkStatus(current);
        cursor = current.application?.latestEventCursor as
          | EventCursor
          | undefined;
        yield snapshotEvent(id, current, status, cursor);
        if (isTerminal(status.state)) return;
        continue;
      }
    }
    for (;;) {
      for (const event of page.events) {
        cursor = event.eventId;
        const decoded = decodeWorkEvent(event, id);
        if (!decoded) continue;
        yield decoded;
        if (decoded.type === "work.status" && isTerminal(decoded.status.state))
          return;
      }
      if (page.events.length > 0) {
        waitAttempt = 0;
        break;
      }
      if (
        !isTerminal(durableWorkStatus(await requireWork(runtime, id)).state)
      ) {
        waitAttempt = await waitForDurableWorkChange(waitAttempt);
        break;
      }
      page = await runtime.store.events.read({
        namespace: runtime.namespace,
        name: `crux.work:${id}`,
        ...(cursor ? { after: cursor } : {}),
        limit: 100,
      });
      if (page.events.length === 0) return;
    }
  }
}

function snapshotEvent(
  id: WorkId,
  work: Awaited<ReturnType<typeof requireWork>>,
  status: ReturnType<typeof durableWorkStatus>,
  cursor: EventCursor | undefined,
): WorkEvent {
  return Object.freeze({
    id: `work.snapshot:${id}:${cursor ?? status.updatedAt.toISOString()}`,
    cursor: cursor ?? `work.snapshot:${id}`,
    workId: id,
    occurredAt: new Date(status.updatedAt),
    type: "work.snapshot",
    status,
  });
}

function decodeWorkEvent(
  event: RuntimeEvent,
  id: WorkId,
): WorkEvent | undefined {
  if (event.name !== `crux.work:${id}`) return undefined;
  const payload = record(event.payload);
  if (!payload || payload.schemaVersion !== 1 || payload.workId !== id)
    return undefined;
  const base = {
    id: event.eventId,
    cursor: event.eventId,
    workId: id,
    occurredAt: new Date(event.appendedAt),
  };
  if (payload.type === "work.status" && payload.status !== undefined) {
    const status = decodeDurableWorkStatus(payload.status);
    return status
      ? Object.freeze({ ...base, type: "work.status", status })
      : undefined;
  }
  if (payload.type === "work.progress" && payload.progress !== undefined) {
    const progress = decodeProgress(payload.progress);
    return progress
      ? Object.freeze({ ...base, type: "work.progress", progress })
      : undefined;
  }
  return undefined;
}

function decodeProgress(value: JsonValue): WorkProgressSnapshot | undefined {
  const progress = record(value);
  if (!progress || typeof progress.updatedAt !== "string") return undefined;
  const updatedAt = new Date(progress.updatedAt);
  if (!Number.isFinite(updatedAt.getTime())) return undefined;
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

async function requireWork(runtime: ResolvedRuntimeEngine, id: WorkId) {
  const work = await runtime.store.state.getWork(id, {
    namespace: runtime.namespace,
  });
  if (!work) throw retainedWorkMissing(id);
  return work;
}

function record(
  value: JsonValue,
): Record<string, JsonValue | undefined> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue | undefined>)
    : undefined;
}

function isTerminal(state: string): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}
