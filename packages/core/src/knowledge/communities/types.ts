/**
 * Shared type contracts for deterministic knowledge communities.
 *
 * @module
 */

import type { KnowledgeRef } from '../refs'

export type CommunityChunkRef = Extract<KnowledgeRef, { readonly kind: 'chunk' }>

export interface CommunityEntityInput {
  readonly entityId: string
  readonly canonicalName: string
  readonly aliases?: readonly string[]
  readonly description?: string
}

export interface CommunityChunkInput {
  readonly ref: CommunityChunkRef
  readonly sourceId: string
  readonly chunkId: string
  readonly ordinal: number
  readonly content: string
}

export interface CommunityEntityEdgeInput {
  readonly leftEntityId: string
  readonly rightEntityId: string
  readonly weight: number
}

export interface CommunityMentionWeightInput {
  readonly chunkRef: CommunityChunkRef
  readonly entityId: string
  readonly weight: number
}

export interface CommunityGraphInput {
  readonly namespace: string
  readonly entities: readonly CommunityEntityInput[]
  readonly edges: readonly CommunityEntityEdgeInput[]
  readonly chunks: readonly CommunityChunkInput[]
  readonly mentionWeights: readonly CommunityMentionWeightInput[]
  readonly residualChunks: readonly CommunityChunkInput[]
}

export interface KnowledgeCommunity {
  readonly communityId: string
  readonly level: number
  readonly kind: 'entity' | 'fallback' | 'parent' | 'root'
  readonly parentCommunityId?: string
  readonly childCommunityIds: readonly string[]
  readonly entityIds: readonly string[]
  readonly chunkRefs: readonly CommunityChunkRef[]
  readonly estimatedInputChars: number
  readonly memberIdentities: readonly string[]
}

export interface KnowledgeCommunityClustering {
  readonly rootCommunityId: string
  readonly communities: readonly KnowledgeCommunity[]
  readonly leaves: readonly KnowledgeCommunity[]
}

export interface CommunityDraft {
  readonly communityId: string
  level: number
  kind: KnowledgeCommunity['kind']
  parentCommunityId?: string
  readonly childCommunityIds: string[]
  readonly entityIds: string[]
  chunkRefs: CommunityChunkRef[]
  estimatedInputChars: number
  readonly memberIdentities: string[]
}
