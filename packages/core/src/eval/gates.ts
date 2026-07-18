/** Eval-specific Gate policy that rejects empty latency declarations. */

import type { Gates } from "./internal/gate-contract";

/** At least one latency ceiling is required when latency policy is present. */
export type EvalLatencyGate =
  | { readonly meanMs: number; readonly p95Ms?: number }
  | { readonly meanMs?: number; readonly p95Ms: number };

/** Declarative Eval Gates with a non-empty latency policy. */
export type EvalGates<Name extends string> = Omit<Gates<Name>, "latency"> & {
  readonly latency?: EvalLatencyGate;
};
