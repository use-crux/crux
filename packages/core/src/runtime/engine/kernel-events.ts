/**
 * Event and suspension composites for the Runtime Engine kernel.
 *
 * @module
 */

import type { EventCursor } from "../ports/ids";
import type { RuntimePendingSuspend } from "../ports/state";
import type { RuntimeWaiter } from "../ports/waiters";
import type { RuntimeOutboxItem, RuntimeStoreTransaction } from "../store";
import {
  flushScheduledWorkInTransaction,
  mergeScheduledWorkRecords,
} from "./kernel-scheduled-work";
import type {
  EmitEventInput,
  EmitEventResult,
  RecordSuspensionInput,
  RuntimeSuspendRegistration,
} from "./kernel-types";
import type {
  RuntimeCompositeDeps,
  RuntimeCompositeRunner,
} from "./composites";
import { scheduleTimerInTransaction } from "./kernel-timers";
import { transition } from "./work";
import { fireWaiter } from "./kernel-waiter-fire";
import { cancelFlowSnapshotBindings } from "./flow-binding-arbitration";
import { preparePredicateSuspends } from "./kernel-predicate-suspension";
import { flowEventResumeKey } from "./idempotency";
import { wakeEnvelopeForWork } from "./kernel-shared";

/** Dependencies for event/suspension kernel operations. */
export interface EmitEventInTransactionDeps extends RuntimeCompositeDeps {}

/** Internal delivery hooks used by higher-level named composites. */
export interface EmitEventInTransactionOptions {
  /** Persist this replay value instead of the matching event payload. */
  readonly deliveryPayload?: EmitEventInput["payload"];
  /** Restrict which resolved waiters this composite may fire. */
  readonly includeWaiter?: (waiter: RuntimeWaiter) => boolean;
  /** Commit related records after one waiter wins its transition. */
  readonly onFired?: (
    waiter: RuntimeWaiter,
    eventId: EventCursor,
  ) => Promise<void>;
}

/** Dependencies for event/suspension kernel operations. */
export interface KernelEventDeps extends EmitEventInTransactionDeps {
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner;
}

/** Persist a flow suspension and owned waiter registrations atomically. */
export async function recordSuspension(
  deps: KernelEventDeps,
  input: RecordSuspensionInput,
): Promise<void> {
  await deps.runComposite("suspension.record", input);
}

/** Persist a flow suspension inside an existing kernel transaction. */
export async function recordSuspensionInTransaction(
  tx: RuntimeStoreTransaction,
  deps: EmitEventInTransactionDeps,
  input: RecordSuspensionInput,
): Promise<void> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  const currentSnapshot = await tx.state.getSnapshot(input.flowId, {
    namespace: input.namespace,
  });
  const prepared = await preparePredicateSuspends(
    tx,
    currentSnapshot,
    input.suspends,
    input.snapshot.deliveredSuspends,
    (suspend) => registerSuspend(tx, input, suspend),
  );
  await cancelFlowSnapshotBindings(
    tx,
    currentSnapshot,
    prepared.retainedWaiterIds,
  );
  if (current && current.status !== "suspended") {
    await tx.state.putWork(transition(current, { status: "suspended" }));
  }
  const flushedWork = await flushScheduledWorkInTransaction(
    tx,
    input.scheduledWork,
    deps.now,
  );

  await tx.state.putSnapshot({
    flowId: input.flowId,
    workId: input.workId,
    targetId: input.targetId,
    namespace: input.namespace,
    status: "suspended",
    input: input.snapshot.input,
    ...(input.snapshot.effects ? { effects: input.snapshot.effects } : {}),
    ...(input.snapshot.continuation
      ? { continuation: input.snapshot.continuation }
      : {}),
    completedSteps: input.snapshot.completedSteps,
    fingerprint: input.snapshot.fingerprint,
    pendingSuspends: prepared.pending,
    deliveredSuspends: prepared.deliveredSuspends,
    scheduledWork: mergeScheduledWorkRecords(
      input.snapshot.scheduledWork,
      flushedWork,
    ),
    updatedAt: deps.now(),
  });
  if (prepared.nextCandidate) {
    const idempotencyKey = flowEventResumeKey(
      input.workId,
      prepared.nextCandidate.eventId,
    );
    const pending = await tx.state.setWorkPending(input.workId, {
      namespace: input.namespace,
      work: { kind: "flow.resume", flowId: input.flowId },
      idempotencyKey,
      now: deps.now(),
    });
    if (!pending)
      throw new Error("Predicate candidate wake could not resume Flow work.");
    await tx.outbox.put(
      { ...wakeEnvelopeForWork(pending), idempotencyKey },
      { deliverAt: deps.now() },
    );
  }
}

/** Append an event and resume all matching waiters that win the CAS race. */
export async function emitEvent(
  deps: KernelEventDeps,
  input: EmitEventInput,
): Promise<EmitEventResult> {
  return await deps.runComposite("event.emit", input);
}

/** Append an event and fire matching waiters inside an existing transaction. */
export async function emitEventInTransaction(
  tx: RuntimeStoreTransaction,
  deps: EmitEventInTransactionDeps,
  input: EmitEventInput,
  options: EmitEventInTransactionOptions = {},
): Promise<EmitEventResult> {
  const event = await tx.events.append({
    namespace: input.namespace,
    name: input.name,
    payload: input.payload,
    eventId: input.eventId,
  });
  const matched = await tx.waiters.resolve(input.name, input.payload, {
    namespace: input.namespace,
  });
  const outboxItems: RuntimeOutboxItem[] = [];
  for (const waiter of matched) {
    if (options.includeWaiter && !options.includeWaiter(waiter)) continue;
    const fired = await fireWaiter({
      tx,
      deps,
      waiter,
      eventId: event.eventId,
      payload: options.deliveryPayload ?? event.payload,
    });
    if (!fired.won) continue;
    await options.onFired?.(waiter, event.eventId);
    outboxItems.push(...fired.outboxItems);
  }
  return { event, outboxItems };
}

async function registerSuspend(
  tx: RuntimeStoreTransaction,
  input: RecordSuspensionInput,
  suspend: RuntimeSuspendRegistration,
): Promise<RuntimePendingSuspend> {
  const waiter = await tx.waiters.register({
    namespace: input.namespace,
    eventName: suspend.eventName,
    ...(suspend.signalId
      ? {
          source: {
            kind: "signal" as const,
            signalId: suspend.signalId,
            ...(suspend.signalPredicate
              ? { filterKind: "predicate" as const }
              : {}),
            ...(suspend.signalMatch === undefined
              ? {}
              : { match: suspend.signalMatch }),
          },
        }
      : {}),
    match: suspend.match,
    workId: input.workId,
    work: { kind: "flow.resume", flowId: input.flowId },
    timeoutAt: suspend.timeoutAt,
  });
  const timer = suspend.timeoutAt
    ? await scheduleTimerInTransaction(tx, {
        namespace: input.namespace,
        fireAt: suspend.timeoutAt,
        workId: input.workId,
        waiterId: waiter.waiterId,
        work: {
          kind: "flow.timeout",
          flowId: input.flowId,
          suspendPoint: suspend.label,
        },
      })
    : undefined;
  if (timer) {
    await tx.waiters.attachTimer(waiter.waiterId, timer.timerId);
  }
  return {
    label: suspend.label,
    deliveryKey: suspend.deliveryKey,
    waiterId: waiter.waiterId,
    timerId: timer?.timerId,
    timeoutAt: suspend.timeoutAt,
    ...(suspend.signalPredicate ? { signalPredicate: true } : {}),
    ...(suspend.signalPredicate ? { candidates: [] } : {}),
  };
}
