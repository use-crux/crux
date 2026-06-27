/**
 * Backend-neutral semantic evidence contract.
 *
 * Semantic backends may use TypeScript or native compiler engines internally.
 * The stable host boundary is evidence batches and source-profile data that
 * contain no raw program, checker, or AST objects.
 *
 * @module
 */

export type {
  SemanticEvidenceBatch,
  SemanticEvidenceBatchKind,
  SemanticEvidenceBatchSource,
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
} from './schema'
export {
  collectProjectedSemanticEvidence,
  projectSemanticEvidenceBatches,
  semanticEvidenceBatchKinds,
  semanticEvidenceBatchesFromFacts,
} from './schema'
