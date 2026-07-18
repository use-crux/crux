import type { CruxHostBinding, ScopeOutcome } from "../scope/types";

/** Logical outcome used to finalize one invocation. */
export type DeferInvocationOutcome = ScopeOutcome;

/** Captured result of running the host handler. */
export type DeferHandlerSettlement<T> =
  | { readonly kind: "returned"; readonly value: T }
  | { readonly kind: "thrown"; readonly error: unknown };

/** Options supplied by a first-party host adapter for one invocation. */
export interface DeferHostBoundaryOptions<T> {
  /** Provider-neutral retention and deferred-work capability binding. */
  readonly binding: CruxHostBinding;
  readonly classifyOutcome: (
    settlement: DeferHandlerSettlement<T>,
  ) => DeferInvocationOutcome;
  /** Internal cancellation source owned by stateful host wrappers. */
  readonly abortController?: AbortController;
}
