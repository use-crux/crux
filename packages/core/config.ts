/**
 * Unified configuration for the Crux prompt system.
 *
 * `config()` is the single public API for configuring Crux.
 * It applies immediately when called — importing the config file IS the setup.
 * Module caching ensures it runs exactly once per process.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@crux/core'
 * import { prompts, contexts } from './convex/prompts'
 *
 * export default config({
 *   prompts,
 *   contexts,
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 *   quality: {
 *     include: './evals/**\/*.eval.ts',
 *     defaults: { replay: 'record-new' },
 *   },
 * })
 * ```
 *
 * @module
 */

import type { FlowToolDef, PromptMiddleware } from './types'
import type { TokenizerFn } from './tokenizer'
import type { PromptRegistry, ConfigureOptions } from './configure'
import type { CruxPlugin } from './plugin'
import type { CruxStore } from './store/types'
import type { QualityConfig } from './quality/config'
import type { RuntimeBridgeOptions } from './runtime-bridge'
import type { CruxLintConfig as CoreCruxLintConfig } from './project-index'
import { connectRuntimeBridge } from './runtime-bridge'
import { configure } from './configure'
import { updateRuntime } from './runtime'
import { registerRegistry as _registerRegistry } from './skill/registry'
import {
  configureObservability,
  createHttpObservabilityTransport,
  type CruxObservabilityTransport,
  type ObservabilityDeliveryOptions,
} from './observability'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Input type for prompts — tree from `createPrompts()`, frozen result, or flat array. */
type PromptInput = ConfigureOptions['prompts']
/** Input type for contexts — tree from `createContexts()`, frozen result, or flat array. */
type ContextInput = ConfigureOptions['contexts']

export type { CruxLintConfig, CruxLintRuleConfig, CruxLintSelectedProfile } from './lint'

/**
 * Trust posture for Project Indexer extension loading.
 *
 * Indexer extensions are JavaScript modules. Loading one is code execution, so Crux treats the trust
 * mode as an explicit tooling policy instead of a convenience flag. Core only stores this value;
 * `@crux/indexer` is responsible for enforcing it before any extension package can contribute to the
 * compiler.
 */
export type CruxIndexerExtensionTrustMode = 'first-party-only' | 'allowlisted' | 'unsafe-local-dev'

export interface CruxIndexerExtensionTrustPolicy {
  /** Default-safe mode is `first-party-only`; third-party packages must be allowlisted explicitly. */
  readonly mode: CruxIndexerExtensionTrustMode
  /** Extension manifest names that may load when `mode` is `allowlisted`. */
  readonly allow?: readonly string[]
  /** Extension manifest names that must never load. Deny entries take precedence over allow entries. */
  readonly deny?: readonly string[]
}

export interface CruxIndexerExtensionReference {
  /** Package specifier to load from a project dependency, for example `@acme/crux-indexer`. */
  readonly package: string
  /** Named export to read from the package. Defaults to `default`. */
  readonly export?: string
  /** Expected extension package version range. Used by tooling before a manifest is accepted. */
  readonly version?: string
  /** Set to `false` to keep the reference in config while excluding it from loading. */
  readonly enabled?: boolean
  /** Extension-specific options. Crux stores these as data; extensions own their option schema. */
  readonly options?: unknown
}

export interface CruxIndexerConfig {
  /**
   * Explicit Project Indexer extension references.
   *
   * This is a declaration list, not a global registration hook. Tooling resolves the references in a
   * deterministic order and reports diagnostics for missing, denied, incompatible, or invalid
   * extensions.
   */
  readonly extensions?: readonly CruxIndexerExtensionReference[]
  /**
   * Trust policy applied before tooling imports or executes extension packages.
   *
   * Omit this to use the indexer's safe default. Use `unsafe-local-dev` only for local experiments
   * where the project fully controls the extension code being loaded.
   */
  readonly trust?: CruxIndexerExtensionTrustPolicy
  /** Rule-specific options keyed by stable rule id, such as `@acme/crux-indexer/require-owner`. */
  readonly rules?: Readonly<Record<string, unknown>>
}

/**
 * Configuration object for `config()`.
 *
 * Contains both runtime config (prompts, contexts, devtools, middleware)
 * and optional Quality config (discovery patterns, persistence, redaction,
 * and run defaults). Live model bindings belong in eval-local helpers.
 */
export interface CruxConfig {
  /** Prompts to register. Tree from `createPrompts()` or flat array. */
  prompts: PromptInput
  /**
   * Contexts to register. Tree from `createContexts()` or flat array.
   * Optional — contexts referenced via prompts' `use` arrays are auto-collected.
   */
  contexts?: ContextInput
  /** Devtools configuration. Enabled when `serverUrl` is truthy. */
  devtools?: {
    /** URL of the devtools server. @default 'http://localhost:4400' */
    serverUrl?: string
    /**
     * Enable the Runtime Bridge command plane.
     *
     * `true` uses the core default WS peer for long-lived local Node runtimes.
     * Framework integrations such as `@crux/convex` can register HTTP bridge
     * endpoints from their setup helpers. Explicit bridge config wins.
     */
    bridge?: RuntimeBridgeOptions
  }
  /**
   * Canonical observability graph transport.
   *
   * Use `serverUrl` for the local Crux devtools server, `transport` for custom
   * runtimes, and call `await observe.flush()`/`shutdown()` in serverless
   * request handlers before returning.
   */
  observability?: {
    enabled?: boolean
    serverUrl?: string
    transport?: CruxObservabilityTransport
    delivery?: ObservabilityDeliveryOptions
  }
  /** Global middleware wrapping every adapter `generate()` call. */
  middleware?: PromptMiddleware
  /** Custom tokenizer function for token counting. */
  tokenizer?: TokenizerFn
  /**
   * Auto-escape all string input values before they reach system/prompt functions.
   * @default true
   */
  autoEscape?: boolean
  /**
   * Log warnings when input fields contain suspicious patterns.
   * Defaults to `true` in development (NODE_ENV !== 'production'), `false` in production.
   */
  securityWarnings?: boolean

  /** Tool definitions to register in the devtools index. */
  tools?: FlowToolDef[]

  /**
   * Plugins to install. Processed in order — each plugin's `install()`
   * receives the cumulative runtime from all prior plugins.
   * Plugins are applied after middleware and devtools setup.
   */
  plugins?: CruxPlugin[]

  /**
   * Quality system configuration (the `quality:` block) — discovery globs,
   * persistence root, redaction, and run defaults.
   * Read by `crux quality` at collect time, never at runtime.
   */
  quality?: QualityConfig

  /** Authored-system lint configuration. Used by Crux devtools and `crux lint`. */
  lint?: CoreCruxLintConfig

  /**
   * Project Indexer configuration. This is inert config data for tooling: core stores it, while the
   * indexer/compiler owns validation, trust policy enforcement, loading, and execution.
   */
  indexer?: CruxIndexerConfig

  /** Global CruxStore for flow state persistence (suspend/resume). */
  store?: CruxStore

  /**
   * Custom skill registries. Keyed by registry name (used as prefix in skill.fromRegistry()).
   * @example
   * ```ts
   * import { registry } from '@crux/core/skill'
   *
   * config({
   *   registries: {
   *     acme: registry({ name: 'acme', baseUrl: 'https://skills.acme.corp' }),
   *   },
   * })
   * ```
   */
  registries?: Record<string, import('./skill/registry').Registry>
}

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
 * Immediately sets up globals (devtools, middleware, tokenizer, etc.)
 * and returns a `Crux` instance that extends `PromptRegistry` with
 * access to the raw config.
 *
 * This is the **only** public API for configuring Crux. Module caching
 * ensures it runs exactly once per process.
 *
 * @example
 * ```ts
 * // crux.config.ts
 * import { config } from '@crux/core'
 * import { prompts, contexts } from './convex/prompts'
 *
 * export default config({
 *   prompts,
 *   contexts,
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 * })
 * ```
 */
export function config(config: CruxConfig): Crux {
  const indexMode =
    typeof process !== 'undefined' &&
    typeof process.env === 'object' &&
    process.env.CRUX_INDEX === '1'

  // Delegate to internal configure() for all the heavy lifting
  const registry = configure({
    prompts: config.prompts,
    contexts: config.contexts,
    devtools: indexMode ? undefined : config.devtools,
    middleware: config.middleware,
    tokenizer: config.tokenizer,
    autoEscape: config.autoEscape,
    securityWarnings: config.securityWarnings,
    tools: config.tools,
    plugins: indexMode ? undefined : config.plugins,
  })

  // Wire store to runtime for flow suspend/resume
  if (config.store) {
    updateRuntime({ store: config.store })
  }

  if (indexMode) {
    configureObservability({ transport: undefined })
    updateRuntime({ observabilityTransport: undefined, observabilityDelivery: undefined })
  } else if (config.observability?.enabled === false) {
    configureObservability({ transport: undefined })
    updateRuntime({ observabilityTransport: undefined, observabilityDelivery: undefined })
  } else {
    const observabilityTransport =
      config.observability?.transport ??
      (config.observability?.serverUrl
        ? createHttpObservabilityTransport({ serverUrl: config.observability.serverUrl })
        : undefined)

    if (observabilityTransport) {
      configureObservability({
        transport: observabilityTransport,
        delivery: config.observability?.delivery,
      })
      updateRuntime({
        observabilityTransport,
        observabilityDelivery: config.observability?.delivery,
      })
    }
  }

  // Wire custom registries for skill.fromRegistry() prefix routing
  if (config.registries) {
    for (const [name, reg] of Object.entries(config.registries)) {
      _registerRegistry(name, reg)
    }
  }

  const bridgeConnection = indexMode
    ? undefined
    : connectRuntimeBridge(config, {
        logger: typeof console !== 'undefined' ? console : undefined,
      })

  // Extend registry with config access
  return Object.freeze({
    ...registry,
    config: Object.freeze({ ...config }),
    dispose() {
      bridgeConnection?.dispose()
      registry.dispose()
    },
  }) as Crux
}
