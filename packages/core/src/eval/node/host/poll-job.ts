/** Bounded coordinator polling for one durable Eval Host V2 job. @internal */

import type {
  EvalHostClient,
  EvalHostJobStatusV2,
} from "../../../runtime/eval-host";
import {
  EVAL_HOST_REQUEST_TIMEOUT_MS,
  EvalHostClientTransportError,
} from "../../../runtime/eval-host";

interface EvalHostPollingOptions {
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Maximum terminal-publication grace after an admitted task deadline.
 *
 * The coordinator performs only status polls during this bounded interval.
 */
export const EVAL_HOST_TERMINAL_GRACE_MS = 5_000;

/** Poll one durable job until terminal publication or the grace cutoff. */
export async function pollEvalHostJobForInternalUse(
  client: EvalHostClient,
  initial: EvalHostJobStatusV2,
  deadlineAtMs: number,
  options: EvalHostPollingOptions = {},
): Promise<EvalHostJobStatusV2> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((durationMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, durationMs)));
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? EVAL_HOST_REQUEST_TIMEOUT_MS;
  const terminalCutoffMs = deadlineAtMs + EVAL_HOST_TERMINAL_GRACE_MS;
  let status = initial;
  while (status.status === "accepted" || status.status === "running") {
    const currentMs = now();
    const terminalRemainingMs = terminalCutoffMs - currentMs;
    if (terminalRemainingMs <= 0) return status;
    const normalRemainingMs = Math.max(0, deadlineAtMs - currentMs);
    await waitForNextPoll(
      sleep(
        Math.min(
          pollIntervalMs,
          normalRemainingMs > 0 ? normalRemainingMs : terminalRemainingMs,
        ),
      ),
      options.signal,
    );
    const requestRemainingMs = terminalCutoffMs - now();
    if (requestRemainingMs <= 0) return status;
    const timeoutMs = Math.min(requestRemainingMs, requestTimeoutMs);
    const terminalBound = requestRemainingMs <= requestTimeoutMs;
    try {
      status = await client.poll(status.jobId, {
        ...(options.signal ? { signal: options.signal } : {}),
        timeoutMs,
      });
    } catch (error) {
      if (
        terminalBound &&
        error instanceof EvalHostClientTransportError &&
        error.code === "EVAL_HOST_REQUEST_TIMEOUT"
      ) {
        return status;
      }
      throw error;
    }
  }
  return status;
}

async function waitForNextPoll(
  pending: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return pending;
  if (signal.aborted) throw pollAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(pollAborted());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([pending, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function pollAborted(): EvalHostClientTransportError {
  return new EvalHostClientTransportError(
    "EVAL_HOST_REQUEST_ABORTED",
    "poll",
    "The Eval host poll request was cancelled by its caller.",
  );
}
