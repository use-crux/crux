/**
 * Final wake commit paths for the Runtime Engine kernel.
 *
 * These helpers keep wake orchestration separate from the durable transactions
 * that finish, suspend, retry, block, or dead-letter leased work.
 *
 * @module
 */

import type { LeaseToken, WorkId } from "../ports/ids";
import type { FlowSnapshot } from "../ports/state";
import type { RuntimeStoreTransaction } from "../store";
import type { CruxRuntimeErrorCode } from "./errors";
import type { RuntimeTargetOutcome, RuntimeWakeResult } from "./kernel-types";
import { recordSuspensionInTransaction } from "./kernel-events";
import {
  flushScheduledWorkInTransaction,
  mergeScheduledWorkRecords,
} from "./kernel-scheduled-work";
import { putWorkWithIdleAccounting } from "./kernel-idle";
import {
  assertLeaseHeldInTransaction,
  isLeaseLostError,
} from "./kernel-leases";
import { runtimeErrorMessage, wakeEnvelopeForWork } from "./kernel-shared";
import type {
  RuntimeCompositeDeps,
  RuntimeCompositeRunner,
} from "./composites";
import { classifyRuntimeFailure } from "./retry";
import { transition, type WorkItem } from "./work";
import { recordSignalDeliveryAttempt } from "../reactive/delivery-state";
import { runtimeRetrySnapshotForError } from "./target-retry";
import { persistMergedRetrySnapshot } from "./kernel-predicate-suspension";
import {
  settleCompletedSignalWork,
  settleFailedSignalWork,
} from "./signal-delivery-settlement";
/** Serialized failure details carried into a wake failure composite. */
export type WakeFailureInput =
  | {
      /** Dead-letter ordinary failures after attempts are exhausted. */
      readonly kind: "dead-letter";
      /** Message preserved from the original thrown value. */
      readonly message: string;
    }
  | {
      /** Block public runtime diagnostics without retrying. */
      readonly kind: "blocked";
      /** Stable runtime error code that caused the terminal block. */
      readonly code: CruxRuntimeErrorCode;
      /** Message preserved from the original thrown value. */
      readonly message: string;
    };
interface FailWorkOptions {
  readonly runComposite: RuntimeCompositeRunner;
  readonly work: WorkItem;
  readonly leaseToken: LeaseToken;
  readonly error: unknown;
  readonly now: () => Date;
  readonly newWorkId: () => WorkId;
  readonly rng?: () => number;
}
/** Record a target failure if the executor still owns the work lease. */
export async function failWork(
  options: FailWorkOptions,
): Promise<Extract<RuntimeWakeResult, { readonly status: 200 }>> {
  if (isLeaseLostError(options.error)) {
    return { status: 200, outcome: "lease-lost" };
  }

  try {
    const classification = classifyRuntimeFailure(options.error, {
      attempt: options.work.attempt,
      maxAttempts: options.work.maxAttempts,
      rng: options.rng,
    });

    if (classification.kind === "retry") {
      const retryAt = new Date(
        options.now().getTime() + classification.delayMs,
      );
      const retrySnapshot = runtimeRetrySnapshotForError(options.error);
      await options.runComposite("wake.retry", {
        work: options.work,
        leaseToken: options.leaseToken,
        retryAt,
        ...(retrySnapshot ? { retrySnapshot } : {}),
      });
      return { status: 200, outcome: "retry-scheduled" };
    }

    const message = runtimeErrorMessage(options.error);
    await options.runComposite("wake.fail", {
      work: options.work,
      leaseToken: options.leaseToken,
      failure:
        classification.kind === "dead-letter"
          ? { kind: "dead-letter", message }
          : { kind: "blocked", code: classification.code, message },
    });
    return {
      status: 200,
      outcome:
        classification.kind === "dead-letter" ? "dead-lettered" : "blocked",
    };
  } catch (error) {
    if (isLeaseLostError(error)) {
      return { status: 200, outcome: "lease-lost" };
    }
    throw error;
  }
}

interface CompleteWorkOptions {
  readonly runComposite: RuntimeCompositeRunner;
  readonly work: WorkItem;
  readonly leaseToken: LeaseToken;
  readonly outcome: RuntimeTargetOutcome;
  readonly idempotencyKey: string;
  readonly now: () => Date;
  readonly newWorkId: () => WorkId;
}

/** Commit a successful target outcome if the executor still owns the lease. */
export async function completeWork(
  options: CompleteWorkOptions,
): Promise<void> {
  if (
    options.outcome.status === "suspended" &&
    options.outcome.suspension.suspends.some(
      (suspend) => suspend.signalId !== undefined,
    )
  ) {
    await options.runComposite("flow.signal-wait.register", {
      work: options.work,
      leaseToken: options.leaseToken,
      outcome: options.outcome,
      idempotencyKey: options.idempotencyKey,
    });
    return;
  }
  await options.runComposite("wake.complete", {
    work: options.work,
    leaseToken: options.leaseToken,
    outcome: options.outcome,
    idempotencyKey: options.idempotencyKey,
  });
}

/** Requeue failed leased work inside a transaction. */
export async function retryWorkAfterFailureInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: {
    readonly work: WorkItem;
    readonly leaseToken: LeaseToken;
    readonly retryAt: Date;
    readonly retrySnapshot?: FlowSnapshot;
  },
): Promise<void> {
  const current = await assertLeaseHeldInTransaction(
    tx,
    input.work,
    input.leaseToken,
  );
  const retryWork = transition(current, {
    status: "pending",
    attempt: current.attempt + 1,
    notBefore: input.retryAt,
  });
  await persistMergedRetrySnapshot(tx, input.retrySnapshot);
  await recordSignalDeliveryAttempt(tx, current, "pending", deps.now());
  await tx.state.putWork(retryWork);
  await tx.outbox.put(wakeEnvelopeForWork(retryWork), {
    deliverAt: input.retryAt,
  });
}

/** Commit terminal failed leased work inside a transaction. */
export async function failWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: {
    readonly work: WorkItem;
    readonly leaseToken: LeaseToken;
    readonly failure: WakeFailureInput;
  },
): Promise<void> {
  const current = await assertLeaseHeldInTransaction(
    tx,
    input.work,
    input.leaseToken,
  );
  const failedWork =
    input.failure.kind === "dead-letter"
      ? transition(current, {
          status: "dead-letter",
          lastError: {
            code: "WORK_DEAD_LETTERED",
            message: input.failure.message,
            at: deps.now(),
          },
        })
      : transition(current, {
          status: "blocked",
          lastError: {
            code: input.failure.code,
            message: input.failure.message,
            at: deps.now(),
          },
        });

  await settleFailedSignalWork(
    tx,
    current,
    input.failure.kind === "dead-letter" ? "dead-letter" : "failed",
    deps.now(),
  );

  await putWorkWithIdleAccounting(
    tx,
    { newWorkId: deps.newWorkId, now: deps.now },
    current,
    failedWork,
  );
}

/** Commit a successful target outcome inside a transaction. */
export async function completeWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: {
    readonly work: WorkItem;
    readonly leaseToken: LeaseToken;
    readonly outcome: RuntimeTargetOutcome;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  const current = await assertLeaseHeldInTransaction(
    tx,
    input.work,
    input.leaseToken,
  );
  await settleCompletedSignalWork(tx, current, input.outcome, deps.now());
  if (input.outcome.status === "suspended") {
    await recordSuspensionInTransaction(tx, deps, input.outcome.suspension);
    await tx.state.putIdempotencyKey({
      namespace: current.namespace,
      key: input.idempotencyKey,
      completedAt: deps.now(),
    });
    return;
  }

  const completed =
    input.outcome.status === "completed"
      ? transition(current, {
          status: "completed",
          resultRef: input.outcome.resultRef,
        })
      : input.outcome.status === "cancelled"
        ? transition(current, { status: "cancelled" })
        : transition(current, {
            status: "blocked",
            lastError: input.outcome.error,
          });
  if (
    (input.outcome.status === "completed" ||
      input.outcome.status === "cancelled") &&
    "flowSnapshot" in input.outcome
  ) {
    const flushedWork = await flushScheduledWorkInTransaction(
      tx,
      input.outcome.scheduledWork,
      deps.now,
    );
    await tx.state.putSnapshot({
      ...input.outcome.flowSnapshot,
      scheduledWork: mergeScheduledWorkRecords(
        input.outcome.flowSnapshot.scheduledWork,
        flushedWork,
      ),
    });
  }
  await putWorkWithIdleAccounting(
    tx,
    { newWorkId: deps.newWorkId, now: deps.now },
    current,
    completed,
  );
  await tx.state.putIdempotencyKey({
    namespace: current.namespace,
    key: input.idempotencyKey,
    completedAt: deps.now(),
  });
}
