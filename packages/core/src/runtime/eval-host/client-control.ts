/** Abort and timer ownership for one bounded Eval host request. */

import {
  EvalHostClientTransportError,
  type EvalHostClientOperation,
} from "./client-errors";

/** One request's composed caller-abort and hard-timeout controller. */
export interface EvalHostRequestControl {
  readonly signal: AbortSignal;
  race<T>(promise: Promise<T>): Promise<T>;
  throwIfAborted(): void;
  dispose(): void;
}

/** Create an isolated first-terminal-wins request controller. */
export function createEvalHostRequestControl(input: {
  readonly operation: EvalHostClientOperation;
  readonly timeoutMs: number;
  readonly externalSignal?: AbortSignal;
}): EvalHostRequestControl {
  const controller = new AbortController();
  let failure: EvalHostClientTransportError | undefined;
  let rejectAbort!: (error: EvalHostClientTransportError) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // The timer or caller may abort before a hostile transport reaches race().
  // Keep that rejection observed without changing what race() propagates.
  void aborted.catch(() => undefined);
  const abort = (kind: "timeout" | "external") => {
    if (failure !== undefined) return;
    failure =
      kind === "timeout"
        ? new EvalHostClientTransportError(
            "EVAL_HOST_REQUEST_TIMEOUT",
            input.operation,
            `The Eval host ${input.operation} request exceeded its bounded deadline. Verify host availability or retry the Eval.`,
          )
        : new EvalHostClientTransportError(
            "EVAL_HOST_REQUEST_ABORTED",
            input.operation,
            `The Eval host ${input.operation} request was cancelled by its caller.`,
          );
    controller.abort();
    rejectAbort(failure);
  };
  const onExternalAbort = () => abort("external");
  if (input.externalSignal?.aborted) onExternalAbort();
  else
    input.externalSignal?.addEventListener("abort", onExternalAbort, {
      once: true,
    });
  const timer = setTimeout(() => abort("timeout"), input.timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    race: <T>(promise: Promise<T>) => Promise.race([promise, aborted]),
    throwIfAborted() {
      if (failure !== undefined) throw failure;
    },
    dispose() {
      clearTimeout(timer);
      input.externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  });
}
