import type { SemanticAnalyzeInput, SemanticBackendIdentity } from '../service/types'
import type { SemanticEvidenceBatchSource } from '../evidence'

/** Native semantic engine implementations available behind the native backend. */
export type NativeSemanticEngineName = 'tsgo'

/** Stable identity for one native engine implementation. */
export interface NativeSemanticEngineIdentity<TName extends NativeSemanticEngineName = NativeSemanticEngineName> {
  /** Native engine implementation name. */
  readonly name: TName
  /** Engine implementation or protocol version. */
  readonly version: string
}

/** Native semantic coverage reported by an engine for one analysis. */
export type NativeSemanticCoverage = {
  readonly kind: 'complete-native'
  readonly engine: NativeSemanticEngineIdentity
  readonly extractors: readonly string[]
}

/** Operational characteristics for a native semantic engine. */
export interface NativeSemanticEngineCapabilities {
  /** Whether the native engine can produce complete Project Index semantic evidence. */
  readonly nativeEvidence: 'complete'
  /** Structural traversal frontend used by the native engine while lowering evidence. */
  readonly syntaxTraversal: 'typescript-ast-facade' | 'native-ast'
}

/** Result of one native semantic engine analysis. */
export interface NativeSemanticAnalyzeResult {
  /** Backend-neutral semantic evidence produced by the native engine. */
  readonly evidence: SemanticEvidenceBatchSource
  /** Coverage path used for this analysis. */
  readonly coverage: NativeSemanticCoverage
}

/**
 * Native engine contract used behind the experimental native semantic backend.
 *
 * Engines may use TypeScript-Go, Rust, or another implementation internally.
 * They must emit compiler-free Semantic Evidence and keep raw compiler handles
 * private to the engine.
 */
export interface NativeSemanticEngine {
  /** Stable native engine identity. */
  readonly identity: NativeSemanticEngineIdentity
  /** Parent semantic backend identity used for cache/session ownership. */
  readonly backendIdentity: SemanticBackendIdentity<'native'>
  /** Engine capabilities used by diagnostics and benchmark planning. */
  readonly capabilities: NativeSemanticEngineCapabilities
  /** Analyze files and return compiler-free semantic evidence. */
  analyze(input: SemanticAnalyzeInput): NativeSemanticAnalyzeResult
  /** Dispose native compiler resources owned by the engine. */
  close(): void
}
