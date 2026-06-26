import type { CruxExperimentalConfig } from '@use-crux/core'
import { loadSemanticProjectConfig } from '../../config'
import { createNativeSemanticBackend } from '../backends/tsgo/backend'
import { createTypeScriptSemanticBackend } from '../backends/typescript/backend'
import type {
  SemanticBackend,
  SemanticBackendOption,
  SemanticBackendSelection,
  SemanticBackendSelectionEnv,
  NativeSemanticBackendSelection,
} from './types'

const semanticBackendEnvKey = 'CRUX_INDEX_SEMANTIC_BACKEND'
const nativeEngineEnvKey = 'CRUX_INDEX_NATIVE_ENGINE'
const nativeTsserverPathEnvKey = 'CRUX_INDEX_NATIVE_TSSERVER_PATH'

/**
 * Returns a semantic backend for a custom backend instance or built-in
 * selection.
 */
export function createSemanticBackendFromSelection<TName extends string = string>(
  option: SemanticBackendOption<TName> | undefined,
): SemanticBackend {
  if (isSemanticBackend(option)) return option
  const selection = normalizeSemanticBackendSelection(option)
  switch (selection.name) {
    case 'typescript':
      return createTypeScriptSemanticBackend()
    case 'native':
      return createNativeSemanticBackend({
        engine: selection.engine,
        tsserverPath: selection.tsserverPath,
      })
  }
}

/** Returns a backend selection from environment overrides when present. */
export function semanticBackendSelectionFromEnv(
  env: SemanticBackendSelectionEnv | undefined,
): SemanticBackendSelection | undefined {
  const name = env?.[semanticBackendEnvKey]
  if (name !== 'typescript' && name !== 'native') return undefined
  if (name === 'typescript') return { name }
  return {
    name,
    engine: nativeEngine(env?.[nativeEngineEnvKey]),
    tsserverPath: env?.[nativeTsserverPathEnvKey],
  }
}

/** Loads backend selection from inert project config data. */
export async function semanticBackendSelectionFromProjectConfig(
  root: string,
  configPath: string | undefined,
): Promise<SemanticBackendSelection | undefined> {
  const result = await loadSemanticProjectConfig(root, configPath)
  return semanticBackendSelectionFromConfig(result.loaded.experimental)
}

/** Converts `config({ experimental })` data into a backend selection. */
export function semanticBackendSelectionFromConfig(
  config: CruxExperimentalConfig | undefined,
): SemanticBackendSelection | undefined {
  const native = config?.indexer?.native
  if (!native) return undefined
  if (native === true) return { name: 'native' }
  return {
    name: 'native',
    engine: native.engine,
    tsserverPath: native.tsserverPath,
  }
}

/** Normalizes built-in backend selection data. */
export function normalizeSemanticBackendSelection(option: SemanticBackendSelection | undefined): BuiltInSelection {
  if (option === 'typescript' || option === undefined) return { name: 'typescript' }
  return option
}

function isSemanticBackend(value: unknown): value is SemanticBackend {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'identity' in value &&
    'capabilities' in value &&
    'createSession' in value &&
    typeof (value as { createSession?: unknown }).createSession === 'function',
  )
}

function nativeEngine(value: string | undefined): NativeSemanticBackendSelection['engine'] {
  return value === 'tsgo' ? 'tsgo' : undefined
}

type BuiltInSelection = { readonly name: 'typescript' } | NativeSemanticBackendSelection
