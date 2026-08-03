/** Work detachment receipts. */

import type { WorkOwnership } from "./status";

/** Result of an idempotent Work detachment request. */
export interface DetachReceipt {
  /** Work occurrence addressed by the request. */
  readonly workId: string;
  /** Whether this request detached Work or found an existing terminal state. */
  readonly outcome: "detached" | "already-detached" | "already-terminal";
  /** Ownership observed after the request. */
  readonly ownership: WorkOwnership;
}
