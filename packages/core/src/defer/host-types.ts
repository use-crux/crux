/** Host boundary after which an inline callback may start. */
export type DeferCompletionClass = "response-finished" | "handler-returned";

/** Logical outcome used to finalize one invocation. */
export type DeferInvocationOutcome =
  | "success"
  | "error"
  | "redirect"
  | "not-found"
  | "cancelled";

/** Captured result of running the host handler. */
export type DeferHandlerSettlement<T> =
  | { readonly kind: "returned"; readonly value: T }
  | { readonly kind: "thrown"; readonly error: unknown };

/** Opaque retained task handed from the invocation kernel to a host lifetime. */
export type DeferScheduledTask = ScopeRetainedTask;

/** Bounded host lifetime capability used for inline deferred work. */
export interface DeferLifetimeCapability {
  readonly completion: DeferCompletionClass;
  readonly limits: DeferLifetimeLimits;
  /**
   * Whether `defer(callback)` may register on this host.
   *
   * Named `defer(target, input)` is gated separately by
   * {@link DeferLifetimeCapability.durableFinalization}. Hosts such as AWS
   * Lambda and Convex set this to `false` and still accept named work when a
   * Runtime is configured.
   */
  readonly supportsInline: boolean;
  readonly durableFinalization: boolean;
  schedule(task: DeferScheduledTask): void;
}

/** Options supplied by a first-party host adapter for one invocation. */
export interface DeferHostBoundaryOptions<T> {
  readonly lifetime: DeferLifetimeCapability;
  readonly classifyOutcome: (
    settlement: DeferHandlerSettlement<T>,
  ) => DeferInvocationOutcome;
}
import type { DeferLifetimeLimits, ScopeRetainedTask } from "../scope/types";

export type { DeferLifetimeLimits } from "../scope/types";
