/**
 * Canonical TypeScript contract for backend-neutral semantic evidence.
 *
 * Semantic backends may use different compiler implementations internally.
 * The stable boundary is compiler-free evidence batches that the shared
 * Project Index projector can consume.
 *
 * @module
 */

export type {
  SemanticEvidenceBatch,
  SemanticEvidenceBatchKind,
  SemanticEvidenceBatchSource,
} from '../../indexer/semantic/evidence/projection'
export {
  collectProjectedSemanticEvidence,
  projectSemanticEvidenceBatches,
  semanticEvidenceBatchKinds,
  semanticEvidenceBatchesFromFacts,
} from '../../indexer/semantic/evidence/projection'
export type {
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
} from '../../indexer/semantic/source-profile'
