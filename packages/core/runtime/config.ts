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
 * import { config } from '@use-crux/core'
 * import { inMemoryRecordStore } from '@use-crux/core/storage'
 *
 * export default config({
 *   quality: {
 *     include: ['evals/**\/*.eval.ts', '**\/*.eval.ts'],
 *     defaults: { replay: 'record-new' },
 *   },
 *   persistence: {
 *     records: inMemoryRecordStore(),
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
import { configure } from './configure'
import { createRuntimeConfigTransaction } from './config-transaction'
import type { CruxFlowRuntimeControls } from './api/flows'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type {
  CruxConfig,
  CruxDevtoolsConfig,
  CruxExperimentalConfig,
  CruxExperimentalIndexerConfig,
  CruxExperimentalIndexerNativeAstConfig,
  CruxExperimentalIndexerNativeConfig,
  CruxExperimentalIndexerNativeEngine,
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
  CruxRuntimeConfig,
} from './config-types'

/**
 * Crux instance returned by `config()`.
 * Extends `PromptRegistry` with access to the raw config.
 */
export interface Crux extends PromptRegistry {
  /** The raw config, for tooling to read quality settings etc. */
  readonly config: Readonly<CruxConfig>
  /** Name-bound Runtime Engine flow controls. */
  readonly flows: CruxFlowRuntimeControls
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
 * import { config } from '@use-crux/core'
 *
 * export default config({
 *   quality: { defaults: { replay: 'record-new' } },
 *   persistence: { records },
 *   generation: { middleware, tokenizer },
 *   observability: { serverUrl: process.env.CRUX_OBSERVABILITY_URL },
 * })
 * ```
 */
export function config(config: CruxConfig): Crux {
  const transaction = createRuntimeConfigTransaction({ config })
  if (transaction.inert) return transaction.createCrux()

  const installation = transaction.apply()
  const registry = configure(transaction.configureOptions)
  const bridgeConnection = installation.connectBridge(registry)

  return installation.createCrux(registry, bridgeConnection)
}
