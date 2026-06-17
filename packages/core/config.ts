/**
 * Unified domain configuration for Crux.
 *
 * `config()` is the single public API for configuring project policy and
 * explicit runtime behavior. Prompt, context, tool, and registry construction
 * remains normal TypeScript code; local tooling discovers those authored values
 * from source rather than requiring duplicate config registration.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@crux/core'
 * import { inMemoryCruxStore } from '@crux/core/store'
 *
 * export default config({
 *   quality: {
 *     include: ['evals/**\/*.eval.ts', '**\/*.eval.ts'],
 *     defaults: { replay: 'record-new' },
 *   },
 *   persistence: {
 *     store: inMemoryCruxStore(),
 *   },
 *   generation: {
 *     tokenizer: (text) => Math.ceil(text.length / 4),
 *   },
 * })
 * ```
 *
 * @module
 */

import type { PromptRegistry } from './configure'
import type { CruxConfig } from './config-types'
import { connectRuntimeBridge } from './runtime-bridge'
import { configure } from './configure'
import { updateRuntime } from './runtime'
import { configureObservability, createHttpObservabilityTransport } from './observability'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type {
  CruxConfig,
  CruxDevtoolsConfig,
  CruxGenerationConfig,
  CruxIndexerConfig,
  CruxIndexerExtensionReference,
  CruxIndexerExtensionTrustMode,
  CruxIndexerExtensionTrustPolicy,
  CruxLintConfig,
  CruxLintRuleConfig,
  CruxLintSelectedProfile,
  CruxObservabilityConfig,
  CruxPersistenceConfig,
} from './config-types'

/**
 * Crux instance returned by `config()`.
 * Extends `PromptRegistry` with access to the raw config.
 */
export interface Crux extends PromptRegistry {
  /** The raw config, for tooling to read quality settings etc. */
  readonly config: Readonly<CruxConfig>
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

/**
 * Define and apply Crux configuration.
 *
 * Immediately sets up globals for the configured domains and returns a
 * `Crux` instance with access to the raw config. Authored primitives are
 * discovered from source; `config()` no longer registers prompts, contexts,
 * tools, or registries.
 *
 * This is the **only** public API for project configuration. Module caching
 * ensures a `crux.config.ts` module runs exactly once per process.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@crux/core'
 *
 * export default config({
 *   quality: { defaults: { replay: 'record-new' } },
 *   persistence: { store },
 *   generation: { middleware, tokenizer },
 *   observability: { serverUrl: process.env.CRUX_OBSERVABILITY_URL },
 * })
 * ```
 */
export function config(config: CruxConfig): Crux {
  const indexMode = typeof process !== 'undefined' && typeof process.env === 'object' && process.env.CRUX_INDEX === '1'
  if (indexMode) return createInertCrux(config)

  const store = config.persistence?.store
  const observabilityTransport =
    config.observability?.enabled !== false
      ? (config.observability?.transport ??
        (config.observability?.serverUrl
          ? createHttpObservabilityTransport({ serverUrl: config.observability.serverUrl })
          : undefined))
      : undefined
  const observabilityDelivery = config.observability?.enabled !== false ? config.observability?.delivery : undefined
  const ownsObservability = config.observability?.enabled === false || observabilityTransport !== undefined
  const restoreObservability = ownsObservability
    ? configureObservability({
        transport: observabilityTransport,
        delivery: observabilityDelivery,
      })
    : undefined

  updateRuntime({
    ...(store ? { store } : {}),
    ...(ownsObservability
      ? {
          observabilityTransport,
          observabilityDelivery,
        }
      : {}),
  })

  // Delegate to internal configure() for all the heavy lifting
  const registry = configure({
    prompts: [],
    devtools: ownsObservability ? undefined : config.devtools,
    middleware: config.generation?.middleware,
    tokenizer: config.generation?.tokenizer,
    autoEscape: config.generation?.autoEscape,
    securityWarnings: config.generation?.securityWarnings,
    plugins: config.plugins ? [...config.plugins] : undefined,
  })

  const bridgeConnection = connectRuntimeBridge(
    {
      devtools: config.devtools,
      quality: config.quality,
      store,
    },
    {
      logger: typeof console !== 'undefined' ? console : undefined,
    },
  )

  // Extend registry with config access
  return Object.freeze({
    ...registry,
    config: Object.freeze({ ...config }),
    dispose() {
      bridgeConnection?.dispose()
      registry.dispose()
      restoreObservability?.()
    },
  }) as Crux
}

function createInertCrux(config: CruxConfig): Crux {
  return Object.freeze({
    prompts: Object.freeze([]),
    contexts: Object.freeze([]),
    get(id: string) {
      throw new Error(`configure: prompt "${id}" not found`)
    },
    find() {
      return undefined
    },
    list() {
      return []
    },
    byTag() {
      return []
    },
    byTags() {
      return []
    },
    tags() {
      return []
    },
    config: Object.freeze({ ...config }),
    dispose() {},
  }) as Crux
}
