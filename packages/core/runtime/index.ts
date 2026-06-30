/**
 * Runtime domain — process configuration, the global hook runtime, plugins,
 * middleware hook contracts, and execution context.
 *
 * This curated barrel is the intra-package entry point for the runtime domain
 * and the surface the published `@use-crux/core` root barrel re-exports. Other
 * Core domains import specific files (`./runtime`, `./plugin`, `./config`, …)
 * directly to stay cycle-free; this barrel is for leaf consumers (the root
 * barrel and tests).
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Configuration — the single `config()` entry point
// ─────────────────────────────────────────────────────────────────

export { config } from './config'
export type {
  Crux,
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
} from './config'
export type { PromptRegistry } from './configure'

// ─────────────────────────────────────────────────────────────────
// Global runtime hook store
// ─────────────────────────────────────────────────────────────────

export { getRuntime, setRuntime, updateRuntime, resetRuntime, resolveRecords } from './runtime'
export type { CruxRuntime } from './runtime'

// ─────────────────────────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────────────────────────

export { mergeRuntime, applyPlugins } from './plugin'
export type { CruxPlugin, CruxPluginResult, ApplyPluginsResult } from './plugin'

// ─────────────────────────────────────────────────────────────────
// Middleware contracts
// ─────────────────────────────────────────────────────────────────

export type { PromptMiddleware, PromptMiddlewareArgs, MiddlewareResult } from './types'

// ─────────────────────────────────────────────────────────────────
// Execution context
// ─────────────────────────────────────────────────────────────────

export { withSession, createSessionId, getExecutionContext, runWithExecutionContext } from './execution-context'
export type { ExecutionContext } from './execution-context'
