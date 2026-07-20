import {
  MAX_WAKE_ENVELOPE_BYTES,
  type CruxEngineCapabilities,
  type HostBoundRuntimeEngineDefinition,
  type RuntimeRetentionConfig,
} from '@use-crux/core/runtime'
import { attachEvalHostConnectionInference } from '@use-crux/core/runtime/internal/eval-host'

/** Default generated Convex runtime entry point for host-bound execution. */
export const CONVEX_RUNTIME_ENTRY = 'createConvexRuntimeHandlers({ targetExecutor }) in convex/_crux/generated.ts'

/** Options accepted by {@link convex}. */
export interface ConvexRuntimeEngineOptions {
  /**
   * Runtime namespace used by generated Convex handlers.
   *
   * If omitted, later setup can infer the Convex deployment context or fall
   * back to `local` for development.
   */
  readonly namespace?: string
  /** Retention policy for terminal Runtime Engine records. */
  readonly retention?: RuntimeRetentionConfig
}

/** Host-bound Runtime Engine declaration for Convex. */
export type ConvexRuntimeEngineDefinition = HostBoundRuntimeEngineDefinition<ConvexRuntimeEngineOptions>

/**
 * Declare Convex as the Runtime Engine host.
 *
 * The returned value is intentionally inert in ordinary Node/serverless
 * processes. Generated or hand-written Convex functions bind request-scoped
 * `ctx`, component refs, and `ctx.scheduler` through
 * `createConvexRuntimeHandlers({ targetExecutor })`, then core composes the
 * kernel via `bindHostRuntime()`.
 */
export function convex(options: ConvexRuntimeEngineOptions = {}): ConvexRuntimeEngineDefinition {
  return attachEvalHostConnectionInference({
    kind: 'host-bound' as const,
    id: 'convex',
    host: 'convex',
    capabilities: CONVEX_RUNTIME_CAPABILITIES,
    entry: CONVEX_RUNTIME_ENTRY,
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.retention ? { retention: options.retention } : {}),
    options: Object.freeze({ ...options }),
  }, {
    infer: (environment) => {
      const url = firstEnvironmentValue(environment, CONVEX_SITE_URL_KEYS)
      const deploymentId = firstEnvironmentValue(environment, CONVEX_CLOUD_URL_KEYS)
      return {
        ...(url ? { url } : {}),
        ...(deploymentId ? { deploymentId } : {}),
      }
    },
  })
}

const CONVEX_CLOUD_URL_KEYS = [
  'CONVEX_CLOUD_URL',
  'CONVEX_URL',
  'NEXT_PUBLIC_CONVEX_URL',
  'EXPO_PUBLIC_CONVEX_URL',
  'PUBLIC_CONVEX_URL',
  'VITE_CONVEX_URL',
  'REACT_APP_CONVEX_URL',
] as const

const CONVEX_SITE_URL_KEYS = [
  'CONVEX_SITE_URL',
  'NEXT_PUBLIC_CONVEX_SITE_URL',
  'EXPO_PUBLIC_CONVEX_SITE_URL',
  'PUBLIC_CONVEX_SITE_URL',
  'VITE_CONVEX_SITE_URL',
  'REACT_APP_CONVEX_SITE_URL',
] as const

function firstEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = environment[key]?.trim()
    if (value) return value
  }
  return undefined
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
