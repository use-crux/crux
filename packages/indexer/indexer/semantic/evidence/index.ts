/**
 * Backend-neutral semantic evidence contracts.
 *
 * Semantic backends stream evidence batches through this boundary. Project
 * Index facts are projected from evidence here so TypeScript and native
 * backends share one normalized output path.
 *
 * @module
 */

export {
  collectProjectedSemanticEvidence,
  semanticEvidenceBatchesFromFacts,
  type SemanticEvidenceBatch,
  type SemanticEvidenceBatchKind,
  type SemanticEvidenceBatchSource,
} from './projection'
export { semanticIndexEvidenceBatches, semanticIndexEvidenceBatchesForSourceFiles } from './facts'
