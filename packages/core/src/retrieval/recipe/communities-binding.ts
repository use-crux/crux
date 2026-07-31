/** Internal Connected Knowledge recipe binding helpers. @module */

import type { CommunitiesConfig } from '../../knowledge/communities/communities'
import { createKnowledgeCommunitiesSurface, type KnowledgeCommunitiesSurface } from '../../knowledge/communities/lifecycle'
import type { ViewRevision } from '../../knowledge/view/revision'
import type { AssetStore, RecordStore } from '../../storage'
import type { Retriever } from '../types'
import type { RetrievalCommunitiesBinding } from './knowledge-binding'

export function createRecipeCommunitiesBinding(input: {
  readonly records?: RecordStore
  readonly assets?: AssetStore
  readonly indexerId: string
  readonly namespace: string
  readonly config?: CommunitiesConfig
  readonly viewId?: string
  readonly resolveView?: () => Promise<ViewRevision>
  readonly retention?: 'cleanup' | 'retain-inactive'
}): { readonly surface?: KnowledgeCommunitiesSurface; readonly binding?: RetrievalCommunitiesBinding } {
  if (!input.config) return {}
  const surface = createKnowledgeCommunitiesSurface({
    records: input.records,
    ...(input.assets ? { assets: input.assets } : {}),
    indexerId: input.indexerId,
    namespace: input.namespace,
    config: input.config,
    ...(input.viewId ? { viewId: input.viewId } : {}),
    ...(input.resolveView ? { resolveView: input.resolveView } : {}),
    ...(input.retention ? { retention: input.retention } : {}),
  })
  return {
    surface,
    binding: Object.freeze({
      surface,
      records: input.records,
      indexerId: input.indexerId,
      namespace: input.namespace,
      strategyFingerprint: input.config.strategyFingerprint,
      ...(input.viewId ? { viewId: input.viewId } : {}),
      ...(input.resolveView ? { resolveView: input.resolveView } : {}),
    }),
  }
}

export function globalSearchRecipeRetriever(id: string, namespace: string): Retriever {
  return Object.freeze({
    _tag: 'Retriever' as const,
    id,
    namespace,
    mode: 'custom' as const,
    retrieve: async () => [],
    asContext: () => { throw new Error('globalSearch() recipe source does not provide context directly.') },
    asTools: () => ({}),
    inject: async () => ({ contexts: [] }),
  }) as unknown as Retriever
}
