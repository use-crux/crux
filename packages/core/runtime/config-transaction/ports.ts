import { configureObservability, createHttpObservabilityTransport } from '../../observability'
import { connectRuntimeBridge } from '../../runtime-bridge'
import { setTokenizer } from '../../shared/tokenizer'
import { applyPlugins } from '../plugin'
import { getRuntime, setRuntime, updateRuntime } from '../runtime'
import type {
  ObservabilityConfigPort,
  PluginInstallerPort,
  RuntimeBridgePort,
  RuntimeConfigTransactionPorts,
  RuntimeStorePort,
  TokenizerPort,
} from './types'

/** Runtime-store port backed by Core's global runtime module. */
export const defaultRuntimeStorePort: RuntimeStorePort = {
  get: getRuntime,
  set: setRuntime,
  update: updateRuntime,
}

/** Observability port backed by Core's canonical observability runtime. */
export const defaultObservabilityConfigPort: ObservabilityConfigPort = {
  createHttpTransport: createHttpObservabilityTransport,
  configure: configureObservability,
}

/** Runtime bridge port backed by Core's devtools bridge connector. */
export const defaultRuntimeBridgePort: RuntimeBridgePort = {
  connect: connectRuntimeBridge,
}

/** Tokenizer port backed by Core's shared tokenizer module. */
export const defaultTokenizerPort: TokenizerPort = {
  setTokenizer,
}

/** Plugin installer port backed by Core's plugin runtime. */
export const defaultPluginInstallerPort: PluginInstallerPort = {
  apply: applyPlugins,
}

/** Fill omitted transaction ports with production Core adapters. */
export function resolveRuntimeConfigPorts(ports: RuntimeConfigTransactionPorts = {}): RequiredPorts {
  return {
    runtime: ports.runtime ?? defaultRuntimeStorePort,
    observability: {
      ...defaultObservabilityConfigPort,
      ...ports.observability,
    },
    bridge: ports.bridge ?? defaultRuntimeBridgePort,
    tokenizer: ports.tokenizer ?? defaultTokenizerPort,
    plugins: ports.plugins ?? defaultPluginInstallerPort,
    diagnostics: ports.diagnostics,
    crux: ports.crux,
  }
}

/** Fully resolved port set used by the effectful installer. */
export interface RequiredPorts {
  readonly runtime: RuntimeStorePort
  readonly observability: ObservabilityConfigPort
  readonly bridge: RuntimeBridgePort
  readonly tokenizer: TokenizerPort
  readonly plugins: PluginInstallerPort
  readonly diagnostics?: RuntimeConfigTransactionPorts['diagnostics']
  readonly crux?: RuntimeConfigTransactionPorts['crux']
}
