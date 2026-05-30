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
 *   eval: {
 *     include: './evals/**\/*.eval.ts',
 *     concurrency: 5,
 *     setup: async () => {
 *       const { generate } = await import('@crux/ai')
 *       return { generate, models: { structured: [...], text: [...] } }
 *     },
 *   },
 * })
 * ```
 *
 * @module
 */

import type { AnyModel, PromptMiddleware } from './types'
import type { TokenizerFn } from './tokenizer'
import type { PromptRegistry, ConfigureOptions } from './configure'
import type { GenerateFn, FlowToolDef } from './testing'
import type { CruxPlugin } from './plugin'
import type { CruxStore } from './store/types'
import type { QualityConfig } from './quality/types'
import type { RuntimeBridgeOptions } from './runtime-bridge'
import type { CruxLintConfig as CoreCruxLintConfig } from './catalog'
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

/** Eval setup result returned by the lazy `setup()` function. */
export interface EvalSetupResult {
  /** The adapter generate function (e.g. `generate` from `@crux/ai`). */
  generate: GenerateFn
  /** Model sets for the eval matrix. */
  models: {
    structured: AnyModel[]
    text: AnyModel[]
  }
}

/** Eval runner configuration. Only used by the CLI. */
export interface CruxEvalConfig {
  /** Glob pattern(s) for prompt eval files. e.g. `'./evals/**\/*.eval.ts'` */
  include: string | string[]
  /** Glob pattern(s) for flow eval files. */
  flowInclude?: string | string[]
  /** Glob pattern(s) for RAG eval files. */
  ragInclude?: string | string[]
  /** Glob pattern(s) for quality suite definitions. */
  suiteInclude?: string | string[]
  /** Max concurrent eval runs. @default 5 */
  concurrency?: number
  /** Per-case timeout in ms. @default 60_000 */
  timeout?: number
  /**
   * Lazy loader for heavy eval dependencies (generate function, model clients).
   * Uses dynamic `import()` to avoid bundling eval deps into runtime actions.
   * Only called by the eval CLI.
   */
  setup: () => Promise<EvalSetupResult>
}

export type { CruxLintConfig, CruxLintRuleConfig, CruxLintSelectedProfile } from './lint'

/**
 * Configuration object for `config()`.
 *
 * Contains both runtime config (prompts, contexts, devtools, middleware)
 * and optional eval config (discovery patterns, lazy model setup).
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

  /** Tool definitions to register in the devtools catalog. */
  tools?: FlowToolDef[]

  /**
   * Plugins to install. Processed in order — each plugin's `install()`
   * receives the cumulative runtime from all prior plugins.
   * Plugins are applied after middleware and devtools setup.
   */
  plugins?: CruxPlugin[]

  /** Eval runner configuration. Only used by the CLI, never at runtime. */
  eval?: CruxEvalConfig

  /** Local Quality Workbench configuration. Used by CLI/devtools quality workflows. */
  quality?: QualityConfig

  /** Authored-system lint configuration. Used by Crux devtools and `crux lint`. */
  lint?: CoreCruxLintConfig

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
  /** The raw config, for tooling to read eval settings etc. */
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
