import type { KnowledgeRef } from '../../../knowledge/refs'
import type { CommunityReport } from '../../../knowledge/communities/records'
import type { KnowledgeStepTrace } from '../step'

export const GLOBAL_SEARCH_BATCH_BUDGET = 24_000
export const GLOBAL_SEARCH_MAX_CALLS = 32
export const GLOBAL_SEARCH_ADAPTIVE_THRESHOLD = 50

export type GlobalSearchScan = 'all' | 'adaptive'
export type GlobalSearchDetail = 'auto' | 'overview' | 'detailed'
export type ResolvedGlobalSearchDetail = Exclude<GlobalSearchDetail, 'auto'>

export interface SearchFindingSource {
  readonly id: string
  readonly statement: string
  readonly supports: readonly KnowledgeRef[]
  readonly assertionRefs: readonly { readonly assertionId: string }[]
}

export interface SearchUnit {
  readonly communityId: string
  readonly generationId: string
  readonly level: number
  readonly parentCommunityId?: string
  readonly title: string
  readonly summary: string
  readonly findings: readonly SearchFindingSource[]
  readonly lineage: {
    readonly viewRevision: string | null
    readonly communityGeneration: string
    readonly reportCommunityId: string
  }
}

export interface FreshnessResolution {
  readonly units: readonly SearchUnit[]
  readonly reports: readonly CommunityReport[]
  readonly coverage: KnowledgeStepTrace['coverage']
  readonly coverageBasis: string
  readonly view?: { readonly id: string; readonly viewRevision: string | null }
  readonly generations: readonly string[]
}

export interface PackedBatch {
  readonly index: number
  readonly units: readonly SearchUnit[]
  readonly inputChars: number
}

export interface GlobalSearchCandidate {
  readonly statement: string
  readonly findingIds: readonly string[]
  readonly score: number
  readonly communityId: string
}
