import {
  MAX_WAKE_ENVELOPE_BYTES,
  type CruxEngineCapabilities,
  type HostBoundRuntimeEngineDefinition,
} from '@use-crux/core/runtime'

/** Default generated Convex runtime entry point for host-bound execution. */
export const CONVEX_RUNTIME_ENTRY =
  'createConvexRuntimeHandlers({ targets }) in convex/crux.ts'

/** Options accepted by {@link convex}. */
export interface ConvexRuntimeEngineOptions {
  /**
   * Runtime namespace used by generated Convex handlers.
   *
   * If omitted, later setup can infer the Convex deployment context or fall
   * back to `local` for development.
   */
  readonly namespace?: string
}

/** Host-bound Runtime Engine declaration for Convex. */
export type ConvexRuntimeEngineDefinition =
  HostBoundRuntimeEngineDefinition<ConvexRuntimeEngineOptions>

/**
 * Declare Convex as the Runtime Engine host.
 *
 * The returned value is intentionally inert in ordinary Node/serverless
 * processes. Generated or hand-written Convex functions bind request-scoped
 * `ctx`, component refs, and `ctx.scheduler` through
 * `createConvexRuntimeHandlers({ targets })`, then core composes the kernel via
 * `bindHostRuntime()`.
 */
export function convex(
  options: ConvexRuntimeEngineOptions = {},
): ConvexRuntimeEngineDefinition {
  return Object.freeze({
    kind: 'host-bound' as const,
    id: 'convex',
    host: 'convex',
    capabilities: CONVEX_RUNTIME_CAPABILITIES,
    entry: CONVEX_RUNTIME_ENTRY,
    ...(options.namespace ? { namespace: options.namespace } : {}),
    options: Object.freeze({ ...options }),
  })
}

const CONVEX_RUNTIME_CAPABILITIES: CruxEngineCapabilities = Object.freeze({
  timers: Object.freeze({ durable: true }),
  wake: Object.freeze({
    atLeastOnce: true,
    signed: true,
    maxPayloadBytes: MAX_WAKE_ENVELOPE_BYTES,
  }),
  events: Object.freeze({ durable: true, cursorReads: true }),
  waiters: Object.freeze({ durable: true }),
  leases: Object.freeze({ durable: true }),
  live: Object.freeze({ available: true }),
  setup: Object.freeze({ canCheck: true, canApply: true }),
  deployment: Object.freeze({
    serverless: 'supported',
    edge: 'unsupported',
    multiProcess: 'supported',
  }),
})
