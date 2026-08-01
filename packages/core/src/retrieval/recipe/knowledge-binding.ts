/**
 * Knowledge graph binding supplied to retrieval recipe steps.
 *
 * @module
 */

import type { KnowledgeGraphReader } from '../../knowledge/graph-types'
import type { KnowledgeCommunitiesSurface } from '../../knowledge/communities/lifecycle'
import type { ViewRevision } from '../../knowledge/view/revision'
import type { KnowledgeRef } from '../../knowledge/refs'
import type { RecordStore } from '../../storage'
import type { RetrieverHit } from '../types'

/** Knowledge graph access bound to a retrieval recipe run. */
export interface RetrievalKnowledgeBinding {
  /** Reader for structural and persisted graph relations visible to the recipe. */
  readonly reader: KnowledgeGraphReader
  /** Namespace inherited from the knowledge base handle. */
  readonly namespace: string
  /** Hydrate a graph reference into a retrieval hit when it addresses an active chunk. */
  readonly hydrate: (ref: KnowledgeRef) => Promise<RetrieverHit | null>
}

/** Community report access bound to a retrieval recipe run. Internal. */
export interface RetrievalCommunitiesBinding {
  readonly surface: KnowledgeCommunitiesSurface
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly strategyFingerprint: string
  readonly viewId?: string
  readonly resolveView?: () => Promise<ViewRevision>
}
