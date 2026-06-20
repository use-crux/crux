import { semanticIndexEvidenceBatchesCached, type SemanticFactsCacheMode } from '../../semantic-cache'
import { semanticIndexEvidenceBatches } from '../facts'
import { createSemanticProgramSession, type SemanticProgramSession } from '../program'
import type {
  SemanticAnalyzeInput,
  SemanticAnalyzeResult,
  SemanticBackend,
  SemanticBackendCapabilities,
  SemanticBackendSession,
  SemanticBackendSessionInput,
  SemanticProjectSessionIdentity,
} from './types'

/** Stable identity for the current TypeScript compiler API semantic backend. */
export const typescriptSemanticBackendIdentity = {
  name: 'typescript',
  version: 'v1',
} as const

/** Operational profile for the TypeScript compiler API backend. */
export const typescriptSemanticBackendCapabilities = {
  apiStability: 'stable',
  factProduction: 'complete',
  sessionReuse: 'backend',
  transport: 'in-process',
} as const satisfies SemanticBackendCapabilities

export interface TypeScriptSemanticBackendOptions {
  /** Durable semantic fact-cache behavior. Defaults to `read-write`. */
  readonly cache?: SemanticFactsCacheMode
  /** Maximum backend-owned TypeScript project sessions to retain. Defaults to 4. */
  readonly maxSessions?: number
}

/**
 * Creates the default semantic backend backed by the TypeScript compiler API.
 *
 * The backend owns all `ts.Program` and `TypeChecker` usage internally. Its
 * public output is limited to streamed semantic evidence so workers and
 * callers stay Crux-shaped rather than compiler-shaped.
 */
export function createTypeScriptSemanticBackend(
  options: TypeScriptSemanticBackendOptions = {},
): SemanticBackend<typeof typescriptSemanticBackendIdentity.name> {
  const sessions = new Map<string, SemanticProgramSession>()
  const maxSessions = options.maxSessions ?? 4

  return {
    identity: typescriptSemanticBackendIdentity,
    capabilities: typescriptSemanticBackendCapabilities,
    createSession(input: SemanticBackendSessionInput): SemanticBackendSession {
      const programSession = sessionForIdentity(sessions, input.identity, maxSessions)
      return {
        identity: input.identity,
        analyze(analyzeInput: SemanticAnalyzeInput): SemanticAnalyzeResult {
          return semanticIndexEvidenceBatchesCached(analyzeInput.root, analyzeInput.files, {
            sourceProfile: analyzeInput.sourceProfile,
            backendIdentity: typescriptSemanticBackendIdentity,
            instrumentation: analyzeInput.instrumentation,
            cache: options.cache,
            produceEvidence: ({ cacheIdentity }) =>
              semanticIndexEvidenceBatches(analyzeInput.root, analyzeInput.files, {
                instrumentation: analyzeInput.instrumentation,
                programSession,
                programIdentity: cacheIdentity,
              }),
          })
        },
      }
    },
  }
}

function sessionForIdentity(
  sessions: Map<string, SemanticProgramSession>,
  identity: SemanticProjectSessionIdentity,
  maxSessions: number,
): SemanticProgramSession {
  const key = semanticProjectSessionCacheKey(identity)
  const existing = sessions.get(key)
  if (existing) return existing

  while (sessions.size >= Math.max(1, maxSessions)) {
    const oldestKey = sessions.keys().next().value
    if (!oldestKey) break
    sessions.delete(oldestKey)
  }

  const session = createSemanticProgramSession()
  sessions.set(key, session)
  return session
}

function semanticProjectSessionCacheKey(identity: SemanticProjectSessionIdentity): string {
  return JSON.stringify({
    root: identity.root,
    tsconfigFiles: identity.tsconfigFiles,
    typescriptVersion: identity.typescriptVersion,
    compilerOptionsId: identity.compilerOptionsId,
    backend: identity.backend,
  })
}
