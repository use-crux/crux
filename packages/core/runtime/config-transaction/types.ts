import type {
  ConfigureObservabilityOptions,
  CruxObservabilityCapturePolicy,
  CruxObservabilityTransport,
  HttpObservabilityTransportOptions,
  ObservabilityDeliveryOptions,
} from '../../observability'
import type {
  RuntimeBridgeConnectOptions,
  RuntimeBridgeConnection,
  RuntimeBridgeManifestInput,
} from '../../runtime-bridge'
import type { TokenizerFn } from '../../shared/tokenizer'
import type { ConfigureOptions, PromptRegistry } from '../configure'
import type { CruxConfig } from '../config-types'
import type { ApplyPluginsResult, CruxPlugin } from '../plugin'
import type { CruxRuntime, HooksLayerToken } from '../runtime'
import type { Crux, RuntimeConfigCruxFactory } from './crux'

/**
 * Environment values that affect config lifecycle planning.
 *
 * The public `config()` function reads from `process.env`; tests can pass this
 * object directly so index-mode behavior stays pure and deterministic.
 */
export interface RuntimeConfigEnvironment {
  /** Mirrors `process.env.CRUX_INDEX`; `'1'` makes config inert. */
  readonly CRUX_INDEX?: string
}

/** Input accepted by the runtime config transaction planner. */
export interface RuntimeConfigTransactionInput {
  /** User-authored project config passed to `config()`. */
  readonly config: CruxConfig
  /** Optional environment override for tests and non-Node runtimes. */
  readonly env?: RuntimeConfigEnvironment
}

/** Port for reading and mutating the global Crux runtime store. */
export interface RuntimeStorePort {
  /** Read the current runtime snapshot. */
  get(): Readonly<CruxRuntime>
  /** Replace the runtime snapshot. */
  set(runtime: CruxRuntime): void
  /** Merge a partial runtime patch into the current snapshot. */
  update(patch: Partial<CruxRuntime>): void
  /** Install a runtime layer and return an opaque restore token. */
  pushLayer(patch: Partial<CruxRuntime>): HooksLayerToken
  /** Restore a previously installed runtime layer. */
  restoreLayer(token: HooksLayerToken): void
}

/** Port for configuring canonical observability transport state. */
export interface ObservabilityConfigPort {
  /** Create an HTTP transport for an explicit observability server URL. */
  createHttpTransport(options: HttpObservabilityTransportOptions): CruxObservabilityTransport
  /** Install the active observability transport and return a restore callback. */
  configure(options: ConfigureObservabilityOptions): () => void
}

/** Port for connecting the devtools runtime bridge. */
export interface RuntimeBridgePort {
  /** Connect a runtime bridge peer for the installed config, when enabled. */
  connect(input: RuntimeBridgeManifestInput, options?: RuntimeBridgeConnectOptions): RuntimeBridgeConnection | undefined
}

/** Port for tokenizer policy mutation. */
export interface TokenizerPort {
  /** Install the configured tokenizer. */
  setTokenizer(tokenizer: TokenizerFn): void
}

/** Port for ordered plugin installation. */
export interface PluginInstallerPort {
  /** Install plugins against the cumulative runtime snapshot. */
  apply(plugins: ReadonlyArray<CruxPlugin>, runtime: CruxRuntime): ApplyPluginsResult
}

/** Diagnostic sink for lifecycle events that should not throw. */
export interface RuntimeConfigDiagnostics {
  /** Report a non-fatal warning. */
  warn(message: string): void
}

/**
 * Ports used by the runtime config transaction.
 *
 * Production config uses default ports backed by Core globals. Tests can pass
 * fakes to verify ordering without observing global state directly.
 */
export interface RuntimeConfigTransactionPorts {
  readonly runtime?: RuntimeStorePort
  readonly observability?: Partial<ObservabilityConfigPort>
  readonly bridge?: RuntimeBridgePort
  readonly tokenizer?: TokenizerPort
  readonly plugins?: PluginInstallerPort
  readonly diagnostics?: RuntimeConfigDiagnostics
  readonly crux?: RuntimeConfigCruxFactory
}

/** How observability transport state should be installed. */
export type RuntimeConfigObservabilityPlan =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'owned'
      readonly transport?: CruxObservabilityTransport
      readonly delivery?: ObservabilityDeliveryOptions
    }
  | {
      readonly kind: 'http'
      readonly serverUrl: string
      readonly token?: string
      readonly delivery?: ObservabilityDeliveryOptions
    }

/** Pure plan produced from user config before any side effects run. */
export interface RuntimeConfigPlan {
  /** True when index mode disables every runtime side effect. */
  readonly inert: boolean
  /** Frozen shallow copy of the user config returned on the Crux instance. */
  readonly config: Readonly<CruxConfig>
  /** Runtime fields installed before plugins and registry construction. */
  readonly runtimePatch: Partial<CruxRuntime>
  /** Whether config owns active observability state and must restore it later. */
  readonly ownsObservability: boolean
  /** Observability installation action for the effectful phase. */
  readonly observability: RuntimeConfigObservabilityPlan
  /** `configure()` options after config-owned side effects have been removed. */
  readonly configureOptions: ConfigureOptions
  /** Runtime bridge input derived from config and persistence. */
  readonly bridgeOptions: RuntimeBridgeManifestInput
  /** Config plugins installed after the runtime patch. */
  readonly plugins: readonly CruxPlugin[]
  /** Optional tokenizer installed before registry construction. */
  readonly tokenizer?: TokenizerFn
}

/** Effectful transaction created from a pure runtime config plan. */
export interface RuntimeConfigTransaction {
  /** True when index mode disables every side effect. */
  readonly inert: boolean
  /** Frozen shallow copy of the user config returned on the Crux instance. */
  readonly config: Readonly<CruxConfig>
  /** `configure()` options to pass to prompt registry construction. */
  readonly configureOptions: ConfigureOptions
  /** Apply side effects and return the installation handle. */
  apply(): RuntimeConfigInstallation
  /** Create an inert `Crux` object without applying side effects. */
  createCrux(registry?: PromptRegistry): Crux
}

/** Installed runtime config transaction with explicit teardown hooks. */
export interface RuntimeConfigInstallation {
  /** Runtime snapshot after config runtime patching and plugin installation. */
  readonly runtime: Readonly<CruxRuntime>
  /** Restore config-owned effects such as plugins and observability. */
  restore(): void
  /** Connect the devtools runtime bridge for a prompt registry. */
  connectBridge(registry: PromptRegistry): RuntimeBridgeConnection | undefined
  /** Create the public `Crux` object for a registry and optional bridge. */
  createCrux(registry: PromptRegistry, bridge?: RuntimeBridgeConnection): Crux
}

export type { CruxObservabilityCapturePolicy }
