/** Safe, result-free Work lifecycle snapshots. */

import type { WorkProgressSnapshot } from "./progress";

/** Ownership relation between Work and the caller that accepted it. */
export type WorkOwnership =
  | { readonly state: "attached" }
  | {
      readonly state: "detached";
      readonly reason: "explicit" | "owner-ended";
      readonly detachedAt: Date;
    };

/** Safe summary of why Work is waiting to resume. */
export interface WorkSuspensionSummary {
  /** Provider-neutral wait category. */
  readonly kind: "approval" | "signal" | "timer" | "work" | "other";
  /** Safe stable identity for the awaited resource, when available. */
  readonly id?: string;
  /** Next scheduled resume time, when known. */
  readonly resumeAt?: Date;
}

/** Safe summary of why Work cannot currently proceed. */
export interface WorkBlockSummary {
  /** Provider-neutral block category. */
  readonly kind:
    | "missing-target"
    | "incompatible-definition"
    | "capability"
    | "other";
  /** Stable machine-readable diagnostic code. */
  readonly code: string;
  /** Safe human-readable diagnostic. */
  readonly message: string;
}

/** Safe terminal failure summary for Work. */
export interface WorkFailure {
  /** Stable machine-readable failure code. */
  readonly code: string;
  /** Safe human-readable failure message. */
  readonly message: string;
  /** Whether a host may retry this Work occurrence. */
  readonly retryable: boolean;
}

interface WorkStatusBase {
  readonly id: string;
  readonly progress?: WorkProgressSnapshot;
  readonly ownership: WorkOwnership;
  readonly updatedAt: Date;
}

/**
 * Safe current lifecycle state for one Work occurrence.
 *
 * @remarks This read model intentionally excludes the target result and raw
 * failures. Retrieve a successful result through {@link WorkHandle.result}.
 */
export type WorkStatus =
  | (WorkStatusBase & { readonly state: "queued"; readonly acceptedAt: Date })
  | (WorkStatusBase & { readonly state: "running"; readonly startedAt: Date })
  | (WorkStatusBase & {
      readonly state: "suspended";
      readonly suspendedOn: WorkSuspensionSummary;
    })
  | (WorkStatusBase & { readonly state: "blocked"; readonly blockedOn: WorkBlockSummary })
  | (WorkStatusBase & {
      readonly state: "completed";
      readonly completedAt: Date;
      readonly resultAvailable: boolean;
    })
  | (WorkStatusBase & {
      readonly state: "failed";
      readonly failedAt: Date;
      readonly failure: WorkFailure;
    })
  | (WorkStatusBase & {
      readonly state: "cancelled";
      readonly cancelledAt: Date;
      readonly reason?: string;
    });
