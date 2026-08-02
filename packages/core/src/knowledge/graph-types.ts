/**
 * Minimal graph reader contract for connected knowledge traversal.
 *
 * Virtual structural relations and persisted graph edges both serve this
 * interface so retrieval code can traverse either source through one boundary.
 *
 * @module
 */

import type { KnowledgeRef } from './refs'

/** Structural relation types projected from indexed knowledge records. */
export type StructuralRelationType = 'hierarchy' | 'sequence'

/** One adjacent graph reference visible from a {@link KnowledgeGraphReader}. */
export interface KnowledgeNeighbor {
  /** Neighboring knowledge reference. */
  readonly ref: KnowledgeRef
  /** Relation type connecting the requested ref and this neighbor. */
  readonly type: string
  /** Edge direction relative to the requested ref. */
  readonly direction: 'out' | 'in'
  /** Evidence support refs, present only when `includeEvidence: true` is set. */
  readonly evidence?: readonly KnowledgeNeighborEvidenceSupport[]
}

/** Chunk-level evidence support ref for an opted-in graph neighbor edge. */
export interface KnowledgeNeighborEvidenceSupport {
  /** Source id that supplied the edge support. */
  readonly sourceId: string
  /** Chunk ref that supplied the edge support. */
  readonly chunkRef: Extract<KnowledgeRef, { readonly kind: 'chunk' }>
  /** Whether the support was exact source evidence or derived from it. */
  readonly provenance: 'exact' | 'derived'
}

/** Options accepted by graph neighbor reads. */
export interface KnowledgeNeighborOptions {
  /** Restrict neighbors to these relation types. */
  readonly types?: readonly string[]
  /** Restrict neighbors by edge direction relative to the requested ref. */
  readonly direction?: 'out' | 'in'
  /** Maximum neighbors to return after structural and persisted edges merge. */
  readonly limit?: number
  /**
   * Include per-edge evidence support refs.
   *
   * Persisted semantic edges return their stored supports. Virtual structural
   * edges, such as `hierarchy` and `sequence`, return an empty evidence list
   * because they are projected from indexed structure and have no supports.
   */
  readonly includeEvidence?: boolean
}

/** Minimal graph reader served by virtual and persisted graph backends. */
export interface KnowledgeGraphReader {
  /** Return neighbors for a reference, ordered deterministically. */
  neighbors(
    ref: KnowledgeRef,
    options?: KnowledgeNeighborOptions,
  ): Promise<KnowledgeNeighbor[]>
}
