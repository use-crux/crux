/**
 * Store-backed timer and maintenance operation types.
 *
 * @module
 */

import type { WaiterId, WorkId } from "../ports/ids";
import type { RuntimeWork } from "../ports/work";
import type { RuntimeOutboxItem } from "../store";
import type { RuntimeWakeDeliver } from "./outbox";

/** Input for scheduling a store-backed runtime timer. */
export interface ScheduleTimerInput {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Deadline when the timer becomes eligible to fire. */
  readonly fireAt: Date;
  /** Work to carry when the timer fires. */
  readonly work: RuntimeWork;
  /** Existing suspended work item to resume, when present. */
  readonly workId?: WorkId;
  /** Linked waiter whose timeout CAS must win before work is produced. */
  readonly waiterId?: WaiterId;
  /** Scoped-idle counter group to stamp onto work minted by the timer. */
  readonly idleScope?: string;
}

/** Options for scanning due store-backed timers. */
export interface ScanTimersOptions {
  /** Namespace to scan. Omit only for maintenance diagnostics. */
  readonly namespace?: string;
  /** Time used to decide whether a timer is due. */
  readonly now?: Date;
  /** Maximum number of due timers to process. */
  readonly limit?: number;
}

/** Result of one store-backed timer scan. */
export interface ScanTimersResult {
  /** Timers that won their race and produced wake work. */
  readonly fired: number;
  /** Timers that were already handled, cancelled, or lost the waiter race. */
  readonly skipped: number;
  /** Wake outbox rows produced by the scan. */
  readonly outboxItems: readonly RuntimeOutboxItem[];
}

/** Transaction helper result for firing one timer record. */
export interface FireTimerRecordResult {
  /** Whether this timer produced runnable work. */
  readonly fired: boolean;
  /** Outbox item produced for the runnable work, when any. */
  readonly outboxItem?: RuntimeOutboxItem;
}

/** Options for one kernel-owned maintenance pass. */
export interface MaintenanceTickOptions {
  /** Namespace to maintain. Omit only for diagnostics and local tests. */
  readonly namespace?: string;
  /** Time source for due timers and outbox eligibility. */
  readonly now?: Date;
  /** Maximum timers to scan. */
  readonly timerLimit?: number;
  /** Maximum leased work records to inspect for reclaim. */
  readonly workLimit?: number;
  /** Maximum expired waiter registrations to inspect. */
  readonly waiterLimit?: number;
  /** Optional wake delivery function for the outbox dispatch backstop. */
  readonly deliver?: RuntimeWakeDeliver;
}

/** Summary of a kernel-owned maintenance pass. */
export interface MaintenanceTickResult {
  /** Outbox rows delivered by the backstop dispatcher. */
  readonly outboxDelivered: number;
  /** Outbox rows that failed delivery and were requeued. */
  readonly outboxFailed: number;
  /** Timers that produced runnable work. */
  readonly timersFired: number;
  /** Timers skipped because another race already won. */
  readonly timersSkipped: number;
  /** Leased work moved back to pending after lease expiry. */
  readonly leasesReclaimed: number;
  /** Unfinalized deferred invocation scopes abandoned after lease expiry. */
  readonly deferredScopesAbandoned: number;
  /** Waiters expired by the no-native-timer backstop. */
  readonly waitersExpired: number;
  /** Pending work rows with no live outbox wake that maintenance re-enqueued. */
  readonly pendingRequeued: number;
  /** Retention records removed. I4 has no retention policy yet. */
  readonly retainedRecordsRemoved: number;
  /** True when a bounded retention sweep left eligible records behind. */
  readonly retentionTruncated?: boolean;
}
