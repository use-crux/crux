/**
 * Sans-I/O call handles for core-step adapters.
 *
 * A handle starts the existing core-step executor and pauses only at provider
 * wire boundaries. Users own the wire call; Crux keeps owning protocol state.
 *
 * @module
 */

import type { AdapterResponse } from "./types";
import type { ApprovalRequestInfo } from "./tool/approval";

/** Error thrown when `finish()` is called before the model run is complete. */
export class CruxIncompleteCallError extends Error {
  override readonly name = "CruxIncompleteCallError";

  /** Tool names still awaiting approval, when the call stopped for approvals. */
  readonly toolNames: readonly string[];

  constructor(message: string, options: { readonly toolNames?: readonly string[] } = {}) {
    super(message);
    this.toolNames = options.toolNames ?? [];
  }
}

/** Error thrown when a previous handle shell is stepped after it advanced. */
export class CruxStaleHandleError extends Error {
  override readonly name = "CruxStaleHandleError";

  constructor() {
    super("This call handle has already advanced. Use the handle returned by the previous step.");
  }
}

/** A response decoder for public handle steps. */
export type CallHandleResponseDecoder<TRawResponse> = (response: TRawResponse) => AdapterResponse;

/** Result of advancing one provider response through Crux protocol. */
export type CallStepOutcome<TParams, TRawResponse, TResult> =
  | {
      readonly done: true;
      readonly result: TResult;
    }
  | {
      readonly done: false;
      readonly next: CallHandle<TParams, TRawResponse, TResult>;
      readonly pendingApprovals?: readonly ApprovalRequestInfo[];
    };

/** Sans-I/O handle for one in-flight provider call. */
export interface CallHandle<TParams, TRawResponse, TResult> {
  /** Provider-native params for the next wire call. */
  readonly params: TParams;
  /** Feed one provider response into Crux and receive either a result or next params. */
  step(response: TRawResponse): Promise<CallStepOutcome<TParams, TRawResponse, TResult>>;
  /** Like `step()`, but throws if Crux needs another provider call. */
  finish(response: TRawResponse): Promise<TResult>;
}
