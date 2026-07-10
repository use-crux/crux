import { configureObservability, createHttpObservabilityTransport } from '../../observability'
import { connectRuntimeBridge } from '../../runtime-bridge'
import { setTokenizer } from '../../shared/tokenizer'
import { applyPlugins } from '../plugin'
import {
  getHooks,
  pushHooksLayer,
  restoreHooksLayer,
  setHooks,
  updateHooks,
} from '../runtime'
import type {
  ObservabilityConfigPort,
  PluginInstallerPort,
  RuntimeBridgePort,
  RuntimeConfigTransactionPorts,
  HooksStorePort,
  TokenizerPort,
} from './types'

/** Hooks-store port backed by Core's global hooks module. */
export const defaultHooksStorePort: HooksStorePort = {
  get: getHooks,
  set: setHooks,
  update: updateHooks,
  pushLayer: pushHooksLayer,
  restoreLayer: restoreHooksLayer,
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
    hooks: ports.hooks ?? defaultHooksStorePort,
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
  readonly hooks: HooksStorePort
  readonly observability: ObservabilityConfigPort
  readonly bridge: RuntimeBridgePort
  readonly tokenizer: TokenizerPort
  readonly plugins: PluginInstallerPort
  readonly diagnostics?: RuntimeConfigTransactionPorts['diagnostics']
  readonly crux?: RuntimeConfigTransactionPorts['crux']
}
