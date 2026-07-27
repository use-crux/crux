/** Stable bounded-transport errors for the private Eval host client. */

/** Authenticated client operation that failed before a valid response. */
export type EvalHostClientOperation = "manifest" | "submit" | "poll" | "cancel";

/** HTTP failure retaining the decoded, byte-bounded host error body. */
export class EvalHostClientError extends Error {
  override readonly name = "EvalHostClientError";
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Eval host request failed with HTTP ${status}.`);
  }
}

export type EvalHostClientTransportErrorCode =
  | "EVAL_HOST_REQUEST_TIMEOUT"
  | "EVAL_HOST_REQUEST_ABORTED"
  | "EVAL_HOST_RESPONSE_TOO_LARGE"
  | "EVAL_HOST_INVALID_RESPONSE"
  | "EVAL_HOST_TRANSPORT_FAILED";

/** Stable transport diagnostic that never retains request credentials or bodies. */
export class EvalHostClientTransportError extends Error {
  override readonly name = "EvalHostClientTransportError";
  constructor(
    readonly code: EvalHostClientTransportErrorCode,
    readonly operation: EvalHostClientOperation,
    message: string,
  ) {
    super(message);
  }
}
