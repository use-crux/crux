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
export interface DeferScheduledTask {
  /** Start the retained callback drain. */
  run(): Promise<void>;
  /** Cooperatively stop waiting for retained callback settlement. */
  cancel(reason?: unknown): void;
}

/** Effective callback limits declared by a host integration. */
export interface DeferLifetimeLimits {
  readonly maxDrainMs: number;
  readonly maxCallbacks: number;
  readonly concurrency: number;
  readonly maxNestingDepth: number;
}

/** Bounded host lifetime capability used for inline deferred work. */
export interface DeferLifetimeCapability {
  readonly completion: DeferCompletionClass;
  readonly limits: DeferLifetimeLimits;
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
