/** Internal Flow lifecycle control errors. */

import type { RuntimeFlowSuspendMetadata, SuspendOptions } from "./types";

/**
 * Internal suspension control used to unwind a Flow handler.
 *
 * @remarks The Flow executor catches this value; application code does not
 * receive it as a durable wait result.
 */
export class FlowSuspendedError extends Error {
  readonly _tag = "FlowSuspendedError" as const;

  /** Create a suspension carrying optional Runtime registration metadata. */
  constructor(
    public readonly suspendPoint: string,
    public readonly options?: SuspendOptions,
    public readonly runtime?: RuntimeFlowSuspendMetadata,
  ) {
    super(`Flow suspended at: ${suspendPoint}`);
    this.name = "FlowSuspendedError";
  }
}

/**
 * Internal cancellation control used to unwind a Flow handler.
 *
 * @remarks The Flow executor converts it to a cancelled lifecycle result.
 */
export class FlowCancelledError extends Error {
  readonly _tag = "FlowCancelledError" as const;

  /** Create cancellation with an optional user-authored reason. */
  constructor(public readonly reason?: string) {
    super(`Flow cancelled${reason ? `: ${reason}` : ""}`);
    this.name = "FlowCancelledError";
  }
}

/**
 * Internal timeout control used to unwind an expired Flow.
 *
 * @remarks The Flow executor converts it to the existing expired outcome.
 */
export class FlowExpiredError extends Error {
  readonly _tag = "FlowExpiredError" as const;

  /** Create expiry for one exact suspend point. */
  constructor(public readonly suspendPoint: string) {
    super(`Flow expired at: ${suspendPoint}`);
    this.name = "FlowExpiredError";
  }
}
