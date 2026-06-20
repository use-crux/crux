import { semanticIndexEvidenceBatchesCached, type SemanticFactsCacheMode } from '../../semantic-cache'
import type { SemanticEvidenceBatch } from '../evidence'
import { emitNativeSemanticCoverage, measureSemanticTiming } from '../instrumentation'
import { createTsgoNativeSemanticEngine, type TsgoNativeSemanticEngineInput } from '../native/tsgo-engine'
import type { NativeSemanticEngine, NativeSemanticEngineName } from '../native/types'
import type {
  SemanticAnalyzeInput,
  SemanticAnalyzeResult,
  SemanticBackend,
  SemanticBackendCapabilities,
  SemanticBackendSession,
  SemanticBackendSessionInput,
  SemanticProjectSessionIdentity,
} from './types'

/** Stable identity for the experimental native semantic backend. */
export const nativeSemanticBackendIdentity = {
  name: 'native',
  version: 'tsgo-native-preview-v1',
} as const

/** Operational profile for the experimental native semantic backend. */
export const nativeSemanticBackendCapabilities = {
  apiStability: 'experimental',
  factProduction: 'complete',
  sessionReuse: 'backend',
  transport: 'ipc',
} as const satisfies SemanticBackendCapabilities

export interface NativeSemanticBackendOptions {
  /** Native engine implementation. Defaults to `tsgo`. */
  readonly engine?: NativeSemanticEngineName
  /** Optional path to the TypeScript-Go executable used by the tsgo engine. */
  readonly tsserverPath?: string
  /** Durable semantic fact-cache behavior. Defaults to `read-write`. */
  readonly cache?: SemanticFactsCacheMode
  /** Maximum backend-owned native engine sessions to retain. Defaults to 2. */
  readonly maxSessions?: number
}

/** Creates the experimental native semantic backend. */
export function createNativeSemanticBackend(
  options: NativeSemanticBackendOptions = {},
): SemanticBackend<typeof nativeSemanticBackendIdentity.name> {
  const engines = new Map<string, NativeSemanticEngine>()
  const maxSessions = options.maxSessions ?? 2

  return {
    identity: nativeSemanticBackendIdentity,
    capabilities: nativeSemanticBackendCapabilities,
    createSession(input: SemanticBackendSessionInput): SemanticBackendSession {
      const engineForSession = () =>
        engineForIdentity(engines, input.identity, maxSessions, input.root, options, input.instrumentation)
      return {
        identity: input.identity,
        analyze(analyzeInput: SemanticAnalyzeInput): SemanticAnalyzeResult {
          return semanticIndexEvidenceBatchesCached(analyzeInput.root, analyzeInput.files, {
            sourceProfile: analyzeInput.sourceProfile,
            backendIdentity: nativeSemanticBackendIdentity,
            instrumentation: analyzeInput.instrumentation,
            cache: options.cache,
            produceEvidence: () => nativeSemanticEvidenceBatches(analyzeInput, engineForSession()),
          })
        },
      }
    },
  }
}

async function* nativeSemanticEvidenceBatches(
  analyzeInput: SemanticAnalyzeInput,
  engine: NativeSemanticEngine,
): AsyncIterable<SemanticEvidenceBatch> {
  const result = engine.analyze(analyzeInput)
  emitNativeSemanticCoverage(analyzeInput.instrumentation, result.coverage)
  yield* result.evidence
}

function engineForIdentity(
  engines: Map<string, NativeSemanticEngine>,
  identity: SemanticProjectSessionIdentity,
  maxSessions: number,
  root: string,
  options: NativeSemanticBackendOptions,
  instrumentation: SemanticBackendSessionInput['instrumentation'],
): NativeSemanticEngine {
  const key = nativeSessionCacheKey(identity)
  const existing = engines.get(key)
  if (existing) return measureSemanticTiming(instrumentation, 'semantic.native.host.reuse', () => existing)

  return measureSemanticTiming(instrumentation, 'semantic.native.host.create', () => {
    while (engines.size >= Math.max(1, maxSessions)) {
      const oldestKey = engines.keys().next().value
      if (!oldestKey) break
      engines.get(oldestKey)?.close()
      engines.delete(oldestKey)
    }

    const engine = createNativeSemanticEngine({
      root,
      session: identity,
      backendIdentity: nativeSemanticBackendIdentity,
      engine: options.engine ?? 'tsgo',
      tsserverPath: options.tsserverPath,
    })
    engines.set(key, engine)
    return engine
  })
}

function createNativeSemanticEngine(
  input: TsgoNativeSemanticEngineInput & { readonly engine: NativeSemanticEngineName },
): NativeSemanticEngine {
  switch (input.engine) {
    case 'tsgo':
      return createTsgoNativeSemanticEngine(input)
  }
}

function nativeSessionCacheKey(identity: SemanticProjectSessionIdentity): string {
  return JSON.stringify({
    root: identity.root,
    tsconfigFiles: identity.tsconfigFiles,
    typescriptVersion: identity.typescriptVersion,
    compilerOptionsId: identity.compilerOptionsId,
    backend: identity.backend,
  })
}
