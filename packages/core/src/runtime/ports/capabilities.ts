/**
 * Runtime adapter capability declarations.
 *
 * Capabilities are adapter-author and diagnostic contracts. Crux tooling uses
 * them to fail early when a configured stack cannot honestly support a durable
 * feature; the kernel still checks at runtime when preflight cannot know.
 *
 * @module
 */

/** Deployment support level reported by a runtime adapter. */
export type DeploymentSupport =
  | 'supported'
  | 'unsupported'
  | 'requires-configuration'

/** Durable Runtime Engine capabilities exposed by an adapter. */
export interface CruxEngineCapabilities {
  /** Timer durability and maximum native delay, when the adapter owns delayed wake. */
  readonly timers: { readonly durable: boolean; readonly maxDelayMs?: number }
  /** Wake delivery guarantees and portable envelope limit. */
  readonly wake: {
    readonly atLeastOnce: boolean
    readonly signed: boolean
    readonly maxPayloadBytes?: number
  }
  /** Durable append/read event support. */
  readonly events: { readonly durable: boolean; readonly cursorReads: boolean }
  /** Durable waiter registration and resolution support. */
  readonly waiters: { readonly durable: boolean }
  /** Durable lease support for concurrent workers. */
  readonly leases: { readonly durable: boolean }
  /** Optional best-effort live delivery support. Never a correctness layer. */
  readonly live: { readonly available: boolean }
  /** Resource setup support. `check` must never mutate; `apply` is additive only. */
  readonly setup: { readonly canCheck: boolean; readonly canApply: boolean }
  /** Deployment compatibility surfaced by preflight diagnostics. */
  readonly deployment: Readonly<
    Record<'serverless' | 'edge' | 'multiProcess', DeploymentSupport>
  >
}
