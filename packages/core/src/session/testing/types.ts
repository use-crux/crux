/** Provider-neutral types for durable Session adapter conformance. */

import type { Session } from "../types";

/** Fixed public input used by every Session conformance law. */
export interface SessionConformanceInput {
  readonly message: string;
}

/** Fixed public output used by every Session conformance law. */
export interface SessionConformanceOutput {
  readonly reply: string;
}

/** Host-local worker lifecycle used without assuming an adapter process model. */
export interface SessionConformanceWorker {
  /** Stop polling and release only this worker's resources. */
  readonly stop: () => Promise<void>;
}

/** Payload-free execution counts used to prove replay idempotency. */
export interface SessionConformanceExecutionCounts {
  readonly executor: number;
  readonly provider: number;
  readonly tool: number;
  readonly effect: number;
}

/** Recoverable cross-store boundary exercised by the shared fault laws. */
export type SessionConformanceFaultBoundary =
  | "after-checkpoint"
  | "after-thread-publication";

/** Isolated public Session host plus narrow adapter observation/fault seams. */
export interface SessionConformanceHarness {
  /** Create or reopen the primary target's keyed Session. */
  readonly create: (
    key: string,
  ) => Promise<Session<SessionConformanceInput, SessionConformanceOutput>>;
  /** Retrieve the primary target's existing keyed Session. */
  readonly get: (
    key: string,
  ) => Promise<Session<SessionConformanceInput, SessionConformanceOutput>>;
  /** Attempt to bind the same key to a distinct target. */
  readonly createConflict: (key: string) => Promise<unknown>;
  /** Attempt Session creation with a declared but incompatible model. */
  readonly createCapabilityFailure: (key: string) => Promise<unknown>;
  /** Read owner identities through the adapter's canonical Thread store. */
  readonly ownerIds: (threadId: string) => Promise<readonly string[]>;
  /** Start the canonical Runtime worker against this harness substrate. */
  readonly startWorker: () =>
    | SessionConformanceWorker
    | Promise<SessionConformanceWorker>;
  /** Arm one real adapter fault at a named Session publication boundary. */
  readonly armFault: (boundary: SessionConformanceFaultBoundary) => void;
  /** Reconstruct the public host while retaining the addressed substrate. */
  readonly reconnect: () => void | Promise<void>;
  /** Count canonical Thread commit receipts for one Session owner. */
  readonly receiptCount: (threadId: string) => Promise<number>;
  /** Bound one failing activation to its first canonical terminal attempt. */
  readonly makeTerminalFailure: () => Promise<void>;
  /** Count Session identities retained in the isolated Runtime namespace. */
  readonly sessionCount: () => number | Promise<number>;
  /** Read adapter-bound execution counts without exposing request payloads. */
  readonly executionCounts: () => SessionConformanceExecutionCounts;
  /** Release host-local resources without deleting durable records. */
  readonly dispose: () => void | Promise<void>;
}

/** Inputs that register the shared Session conformance suite. */
export interface RunSessionConformanceTestsOptions {
  /** Human-readable adapter name used for the Vitest suite. */
  readonly name: string;
  /** Create a fresh isolated host for one named conformance law. */
  readonly createHarness: (
    law: string,
  ) => SessionConformanceHarness | Promise<SessionConformanceHarness>;
}
