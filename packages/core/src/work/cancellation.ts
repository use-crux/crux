/** Work cancellation requests and receipts. */

import type { WorkStatus } from "./status";

/** Optional safe caller context for a Work cancellation request. */
export interface CancelOptions {
  /** Safe reason retained with a successful cancellation, up to 512 characters. */
  readonly reason?: string;
}

/** Result of an idempotent Work cancellation request. */
export interface CancelReceipt {
  /** Work occurrence addressed by the request. */
  readonly workId: string;
  /** Whether cancellation succeeded or the Work was already terminal. */
  readonly outcome: "cancelled" | "already-terminal";
  /** Terminal state observed after the request. */
  readonly status: Extract<
    WorkStatus,
    { readonly state: "completed" | "failed" | "cancelled" }
  >;
}
