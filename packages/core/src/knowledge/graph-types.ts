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
}

/** Minimal graph reader served by virtual and persisted graph backends. */
export interface KnowledgeGraphReader {
  /** Return neighbors for a reference, ordered deterministically. */
  neighbors(
    ref: KnowledgeRef,
    options?: {
      readonly types?: readonly string[]
      readonly direction?: 'out' | 'in'
      readonly limit?: number
    },
  ): Promise<KnowledgeNeighbor[]>
}
