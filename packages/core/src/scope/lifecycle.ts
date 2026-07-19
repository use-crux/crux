import type { ScopeCloseOutcome } from "./contracts";
import type { ScopeSealedReason } from "./types";

/** Map a scope settlement to its terminal sealing reason. */
export function sealedReasonFor(outcome: ScopeCloseOutcome): ScopeSealedReason {
  if (outcome === "error") return "error";
  if (outcome === "timeout") return "timeout";
  if (outcome === "cancelled") return "cancelled";
  return "closed";
}

/** Return whether a value exposes a promise-like `then` method. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null && "then" in value) ||
    (typeof value === "function" && "then" in value)
  );
}
