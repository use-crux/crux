/** Kernel-owned named composite registry. */

import { cancelWorkInTransaction } from "../kernel-cancellation";
import {
  abandonDeferredScopeInTransaction,
  expireDeferredScopeInTransaction,
  finalizeDeferredScopeInTransaction,
  renewDeferredScopeLeaseInTransaction,
  stageDeferredIntentInTransaction,
} from "../kernel-deferred";
import {
  emitEventInTransaction,
  recordSuspensionInTransaction,
} from "../kernel-events";
import { retryWorkInTransaction } from "../kernel-retry";
import { enqueueTaskInTransaction } from "../kernel-tasks";
import { fireDueTimersInTransaction } from "../kernel-timers";
import { blockMissingTargetInTransaction } from "../kernel-wake";
import {
  completeWorkInTransaction,
  failWorkInTransaction,
  retryWorkAfterFailureInTransaction,
} from "../kernel-wake-commits";
import {
  expireWaitersInTransaction,
  reclaimLeasedWorkInTransaction,
  requeuePendingWorkIfStillOrphanedInTransaction,
} from "../maintenance";
import type { RuntimeCompositeBody, RuntimeCompositeKind } from "../composites";
import { publishSignalInTransaction } from "./signal";
import { resumeFlowManuallyInTransaction } from "./flow-manual-resume";

/** Transaction body selected for every known composite name. */
export const runtimeCompositeBodies: {
  readonly [K in RuntimeCompositeKind]: RuntimeCompositeBody<K>;
} = Object.freeze({
  "flow.manual-resume": resumeFlowManuallyInTransaction,
  "flow.signal-wait.register": completeWorkInTransaction,
  "signal.publish": publishSignalInTransaction,
  "wake.block-missing-target": blockMissingTargetInTransaction,
  "wake.retry": retryWorkAfterFailureInTransaction,
  "wake.fail": failWorkInTransaction,
  "wake.complete": completeWorkInTransaction,
  "suspension.record": recordSuspensionInTransaction,
  "event.emit": emitEventInTransaction,
  "timers.fire-due": fireDueTimersInTransaction,
  "task.enqueue": enqueueTaskInTransaction,
  "work.cancel": cancelWorkInTransaction,
  "work.operator-retry": retryWorkInTransaction,
  "maintenance.reclaim-lease": reclaimLeasedWorkInTransaction,
  "maintenance.requeue-orphan": requeuePendingWorkIfStillOrphanedInTransaction,
  "maintenance.expire-waiters": expireWaitersInTransaction,
  "defer.stage": stageDeferredIntentInTransaction,
  "defer.finalize": finalizeDeferredScopeInTransaction,
  "defer.abandon": abandonDeferredScopeInTransaction,
  "defer.renew": renewDeferredScopeLeaseInTransaction,
  "defer.expire": expireDeferredScopeInTransaction,
});
