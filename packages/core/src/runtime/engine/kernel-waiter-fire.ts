/** Waiter race resolution and wake creation. */

import type { JsonValue } from "../../storage";
import type { EventCursor } from "../ports/ids";
import type { RuntimeWaiter } from "../ports/waiters";
import type { RuntimeOutboxItem, RuntimeStoreTransaction } from "../store";
import type { RuntimeCompositeDeps } from "./composites";
import { flowEventResumeKey, taskRunKey } from "./idempotency";
import {
  isTerminalWork,
  targetIdForNewWork,
  wakeEnvelopeForWork,
} from "./kernel-shared";
import type { WorkItem } from "./work";

interface FireWaiterOptions {
  readonly tx: RuntimeStoreTransaction;
  readonly deps: RuntimeCompositeDeps;
  readonly waiter: RuntimeWaiter;
  readonly eventId: EventCursor;
  readonly payload: JsonValue;
}

/** Fire one armed waiter and create its wake row when it wins. */
export async function fireWaiter(options: FireWaiterOptions): Promise<{
  readonly won: boolean;
  readonly outboxItems: readonly RuntimeOutboxItem[];
}> {
  const won = await options.tx.waiters.transition(
    options.waiter.waiterId,
    "armed",
    "fired",
  );
  if (!won) return { won: false, outboxItems: [] };

  if (options.waiter.timerId) {
    await options.tx.timers.transition(
      options.waiter.timerId,
      "scheduled",
      "cancelled",
    );
  }
  if (!options.waiter.workId) {
    return fireUnownedWaiter(options);
  }

  const idempotencyKey = flowEventResumeKey(
    options.waiter.workId,
    options.eventId,
  );
  const transitioned = await options.tx.state.setWorkPending(
    options.waiter.workId,
    {
      namespace: options.waiter.namespace,
      work: options.waiter.work,
      idempotencyKey,
      now: options.deps.now(),
    },
  );
  const wakeWork =
    transitioned ??
    (await options.tx.state.getWork(options.waiter.workId, {
      namespace: options.waiter.namespace,
    }));
  if (!wakeWork || isTerminalWork(wakeWork)) {
    return { won: true, outboxItems: [] };
  }

  await options.tx.state.markSnapshotDelivered(options.waiter.workId, {
    namespace: options.waiter.namespace,
    waiterId: options.waiter.waiterId,
    eventId: options.eventId,
    payload: options.payload,
  });
  return {
    won: true,
    outboxItems: [
      await options.tx.outbox.put(
        { ...wakeEnvelopeForWork(wakeWork), idempotencyKey },
        { deliverAt: options.deps.now() },
      ),
    ],
  };
}

async function fireUnownedWaiter(options: FireWaiterOptions): Promise<{
  readonly won: true;
  readonly outboxItems: readonly RuntimeOutboxItem[];
}> {
  const work = await createUnownedWork(options);
  return {
    won: true,
    outboxItems: [
      await options.tx.outbox.put(wakeEnvelopeForWork(work), {
        deliverAt: options.deps.now(),
      }),
    ],
  };
}

async function createUnownedWork(
  options: FireWaiterOptions,
): Promise<WorkItem> {
  const workId = options.deps.newWorkId();
  return await options.tx.state.createWork({
    workId,
    namespace: options.waiter.namespace,
    work: options.waiter.work,
    targetId: targetIdForNewWork(options.waiter.work),
    idempotencyKey: taskRunKey(workId),
    now: options.deps.now(),
  });
}
