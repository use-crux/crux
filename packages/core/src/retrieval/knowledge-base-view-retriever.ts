/**
 * View-scoped retriever construction for connected knowledge.
 *
 * @module
 */

import type { EmbeddingModality } from '../embedding'
import { indexedChunkKey } from '../indexed-knowledge/keys'
import { indexedChunkToHit } from '../indexed-knowledge/records'
import type { ViewRevision } from '../knowledge/view/revision'
import type { NormalizedViewWhere } from '../knowledge/view/where'
import type { ExactFilter, RecordStore } from '../storage'
import { createRetrieverEntity } from './entity'
import type { Retriever, RetrieverHit } from './types'

const branchCeiling = 16

/** Create a retriever constrained to a resolved view revision. */
export function createViewRetriever<TModality extends EmbeddingModality>(config: {
  readonly id: string
  readonly indexerId: string
  readonly namespace: string
  readonly where: NormalizedViewWhere
  readonly base: Retriever<ExactFilter, TModality>
  readonly records?: RecordStore
  readonly resolveRevision: () => Promise<ViewRevision>
  readonly assertRevisionAvailable: (revision: ViewRevision) => Promise<void>
  readonly defaultLimit?: number
  readonly defaultFilter?: ExactFilter
}): Retriever<ExactFilter, TModality> {
  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: config.base.mode,
    retrieve: async (request) => {
      const branches = expandBranches(config.where, { ...(config.defaultFilter ?? {}), ...(request.filter ?? {}) })
      if (branches.length > branchCeiling) {
        throw new Error(
          `View "${config.id}" expands to ${branches.length} vector filter branches; the portable path supports at most ${branchCeiling}. Narrow the predicate, split the view, or use storage with connected-knowledge view pushdown.`,
        )
      }
      const limit = request.limit ?? config.defaultLimit
      const revision = await config.resolveRevision()
      const members = new Set(revision.members.map((member) => member.sourceId))
      const groups = await Promise.all(branches.map((filter) => config.base.retrieve({ ...request, limit, filter })))
      await config.assertRevisionAvailable(revision)
      return stampViewRevision(
        bestHits(groups.flat().filter((hit) => hit.kind !== 'finding' && members.has(hit.source.id)), limit),
        revision.revisionHash,
      )
    },
    ...(config.records ? { getSource: viewGetSource(config) } : {}),
  })
}

function stampViewRevision(hits: readonly RetrieverHit[], revisionHash: string): RetrieverHit[] {
  return hits.map((hit) => hit.kind === 'finding' ? hit : {
    ...hit,
    metadata: { ...hit.metadata, viewRevision: revisionHash },
  })
}

function expandBranches(where: NormalizedViewWhere, base: ExactFilter): ExactFilter[] {
  const branches = where.any.flatMap((clause) =>
    clause.reduce<ExactFilter[]>(
      (partials, term) => partials.flatMap((partial) =>
        term.values.flatMap((value) => mergeBranchTerm(partial, term.field, value))),
      [base],
    ),
  )
  return dedupeFilters(branches)
}

function mergeBranchTerm(partial: ExactFilter, field: string, value: ExactFilter[string]): readonly ExactFilter[] {
  if (partial[field] !== undefined && partial[field] !== value) return []
  return [{ ...partial, [field]: value }]
}

function viewGetSource(config: {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly resolveRevision: () => Promise<ViewRevision>
  readonly assertRevisionAvailable: (revision: ViewRevision) => Promise<void>
}) {
  return async (lookup: { readonly namespace: string; readonly sourceId: string; readonly chunkId: string }): Promise<RetrieverHit | null> => {
    if (!config.records || lookup.namespace !== config.namespace) return null
    const revision = await config.resolveRevision()
    if (!revision.members.some((member) => member.sourceId === lookup.sourceId)) return null
    await config.assertRevisionAvailable(revision)
    const value = await config.records.get(indexedChunkKey(config.indexerId, config.namespace, lookup.sourceId, lookup.chunkId))
    return value ? indexedChunkToHit({ value, score: 1 }) : null
  }
}

function dedupeFilters(filters: readonly ExactFilter[]): ExactFilter[] {
  const seen = new Set<string>()
  const result: ExactFilter[] = []
  for (const filter of filters) {
    const normalized = Object.keys(filter).sort().map((key) => [key, filter[key]])
    const key = JSON.stringify(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(filter)
  }
  return result
}

function bestHits(hits: readonly RetrieverHit[], limit: number | undefined): RetrieverHit[] {
  const byKey = new Map<string, RetrieverHit>()
  for (const hit of hits) {
    const key = hitKey(hit)
    const existing = byKey.get(key)
    if (!existing || hit.score > existing.score) byKey.set(key, hit)
  }
  const ranked = [...byKey.values()].sort((left, right) => right.score - left.score || hitKey(left).localeCompare(hitKey(right)))
  return limit === undefined ? ranked : ranked.slice(0, limit)
}

function hitKey(hit: RetrieverHit): string {
  return hit.kind === 'finding'
    ? `${hit.namespace}:finding:${hit.citation.findingTarget}`
    : `${hit.namespace}:${hit.source.id}:${hit.chunkId}`
}
