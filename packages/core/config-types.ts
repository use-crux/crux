/**
 * Public domain-shaped configuration types for `config()`.
 *
 * The launch config surface describes policy and explicit runtime behavior.
 * Authored primitives such as prompts, contexts, tools, and registries live in
 * normal TypeScript code and are discovered by local tooling instead of being
 * repeated in project config.
 *
 * @module
 */

import type { CruxObservabilityTransport, ObservabilityDeliveryOptions } from './observability'
import type { CruxPlugin } from './plugin'
import type { CruxLintConfig as CoreCruxLintConfig } from './project-index'
import type { QualityConfig } from './quality/config'
import type { RuntimeBridgeOptions } from './runtime-bridge'
import type { CruxStore } from './store/types'
import type { TokenizerFn } from './tokenizer'
import type { PromptMiddleware } from './types'

export type { CruxLintConfig, CruxLintRuleConfig, CruxLintSelectedProfile } from './lint'

/**
 * Trust posture for Project Indexer extension loading.
 *
 * Indexer extensions are JavaScript modules. Loading one is code execution, so
 * Crux treats the trust mode as an explicit tooling policy rather than a
 * convenience flag. Core stores this value; `@crux/indexer` enforces it before
 * extension packages can contribute to compilation.
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

export type CruxExperimentalIndexerNativeEngine = 'tsgo'

export interface CruxExperimentalIndexerNativeConfig {
  /**
   * Native semantic engine implementation.
   *
   * `tsgo` is the first implementation and uses TypeScript-Go native-preview
   * internally. The public switch remains `native` so future native engines can
   * preserve the same user-facing contract.
   */
  readonly engine?: CruxExperimentalIndexerNativeEngine
  /** Optional TypeScript-Go executable path used when `engine` is `tsgo`. */
  readonly tsserverPath?: string
}

export interface CruxExperimentalIndexerConfig {
  /**
   * Enable the experimental native semantic backend for Project Index
   * enrichment.
   *
   * `true` uses the default native engine. An object enables the backend and
   * supplies native-engine options. Omit or set `false` to keep the JavaScript
   * TypeScript compiler API backend.
   */
  readonly native?: boolean | CruxExperimentalIndexerNativeConfig
}

export interface CruxExperimentalConfig {
  /**
   * Experimental Project Indexer behavior.
   *
   * Options here are intentionally unstable and may graduate into stable domains
   * or change before public launch.
   */
  readonly indexer?: CruxExperimentalIndexerConfig
}

export interface CruxIndexerConfig {
  /**
   * Explicit Project Indexer extension references.
   *
   * This is a declaration list, not a global registration hook. Tooling resolves
   * references in deterministic order and reports diagnostics for missing,
   * denied, incompatible, or invalid extensions.
   */
  readonly extensions?: readonly CruxIndexerExtensionReference[]
  /**
   * Trust policy applied before tooling imports or executes extension packages.
   *
   * Omit this to use the indexer's safe default. Use `unsafe-local-dev` only
   * for local experiments where the project fully controls loaded extension
   * code.
   */
  readonly trust?: CruxIndexerExtensionTrustPolicy
  /** Rule-specific options keyed by stable rule id, such as `@acme/crux-indexer/require-owner`. */
  readonly rules?: Readonly<Record<string, unknown>>
}

export interface CruxDevtoolsConfig {
  /**
   * Explicit devtools server or tunnel URL for runtime records.
   *
   * Ordinary local Quality runs auto-attach to a loopback `crux dev` server
   * without project config. Set this only when application runtime code should
   * send local/tunnel devtools records or derive bridge URLs from a known
   * endpoint.
   */
  readonly serverUrl?: string
  /**
   * Enable the Runtime Bridge command plane.
   *
   * `true` uses the core default WS peer for long-lived local Node runtimes.
   * Framework integrations such as `@crux/convex` can register HTTP bridge
   * endpoints from their setup helpers. Explicit bridge config wins.
   */
  readonly bridge?: RuntimeBridgeOptions
}

export interface CruxObservabilityConfig {
  /** Set `false` to explicitly disable an already configured observability transport. */
  readonly enabled?: boolean
  /**
   * Explicit observability ingest endpoint used to create an HTTP transport.
   *
   * Use this for deliberate export/custom transport behavior. Production
   * telemetry, remote collectors, cloud upload, and raw-content capture are
   * never enabled by default.
   */
  readonly serverUrl?: string
  /** Custom canonical observability graph transport. */
  readonly transport?: CruxObservabilityTransport
  /** Delivery bounds for batching, flushing, and shutdown. */
  readonly delivery?: ObservabilityDeliveryOptions
}

export interface CruxPersistenceConfig {
  /**
   * Global CruxStore for runtime persistence such as flow suspend/resume.
   *
   * Persistence is explicit because Crux cannot infer durability, tenancy,
   * storage backend, or data-locality policy from source discovery.
   */
  readonly store?: CruxStore
}

export interface CruxGenerationConfig {
  /** Global middleware wrapping every adapter `generate()` call. */
  readonly middleware?: PromptMiddleware
  /** Custom tokenizer function for token counting. */
  readonly tokenizer?: TokenizerFn
  /**
   * Auto-escape all string input values before they reach system/prompt functions.
   * @default true
   */
  readonly autoEscape?: boolean
  /**
   * Log warnings when input fields contain suspicious patterns.
   * Defaults to `true` in development (NODE_ENV !== 'production'), `false` in production.
   */
  readonly securityWarnings?: boolean
}

/**
 * Configuration object for `config()`.
 *
 * The top-level keys are domain names. Config controls explicit policy,
 * persistence, generation hooks, devtools, observability, and plugins. It does
 * not register prompts, contexts, tools, or registries for local discovery.
 */
export interface CruxConfig {
  /**
   * Quality system configuration (the `quality:` block): discovery globs,
   * persistence root, redaction, and run defaults.
   */
  readonly quality?: QualityConfig
  /** Authored-system lint configuration. Used by Crux devtools and `crux lint`. */
  readonly lint?: CoreCruxLintConfig
  /**
   * Project Indexer configuration. This is inert config data for tooling: core
   * stores it, while the indexer/compiler owns validation, trust policy
   * enforcement, loading, and execution.
   */
  readonly indexer?: CruxIndexerConfig
  /**
   * Experimental feature flags and provisional options.
   *
   * Stable defaults live in their owning top-level domains. Features here are
   * explicit opt-ins and may change before public launch.
   */
  readonly experimental?: CruxExperimentalConfig
  /** Explicit persistence backend choices. */
  readonly persistence?: CruxPersistenceConfig
  /** Cross-cutting generation behavior. Model choices belong in eval/agent code. */
  readonly generation?: CruxGenerationConfig
  /** Non-default local, tunnel, remote, or bridge devtools behavior. */
  readonly devtools?: CruxDevtoolsConfig
  /** Explicit observability export or custom transport behavior. */
  readonly observability?: CruxObservabilityConfig
  /**
   * Plugins to install. Processed in order; each plugin's `install()` receives
   * the cumulative runtime from all prior plugins.
   */
  readonly plugins?: readonly CruxPlugin[]
}
