/**
 * Relation expansion retrieval recipe step.
 *
 * @module
 */

import type { KnowledgeNeighbor } from '../../../knowledge/graph-types'
import { encodeKnowledgeRef, type KnowledgeRef } from '../../../knowledge/refs'
import type { EvidenceHit, RetrieverHit } from '../../types'
import { markBuiltInRetrievalStep, retrievalStep, type RetrievalStep } from '../step'

type RelationDirection = 'out' | 'in' | 'both'
type SeedSource = 'hits' | 'query'

/** Configuration for {@link expandRelations}. */
export interface ExpandRelationsConfig {
  /** Relation types to traverse. Defaults to all visible relation types. */
  readonly types?: readonly string[]
  /** Direction to traverse relative to each visited ref. Defaults to `both`. */
  readonly direction?: RelationDirection
  /** Maximum semantic hop distance to traverse. Defaults to `1`. */
  readonly depth?: number
  /** Maximum unique added hits across all seeds. Defaults to `20`. */
  readonly limit?: number
  /** Seed sources. Defaults to `['hits', 'query']`. */
  readonly seeds?: readonly SeedSource[]
}

type Candidate = {
  readonly ref: KnowledgeRef
  readonly encoded: string
  readonly distance: number
  readonly seedRank: number
  readonly support: ReadonlySet<string>
  readonly path: readonly KnowledgeRef[]
  readonly edges: readonly string[]
  readonly discoveryRank: number
}

type QueueItem = {
  readonly ref: KnowledgeRef
  readonly seed: KnowledgeRef
  readonly seedRank: number
  readonly distance: number
  readonly path: readonly KnowledgeRef[]
  readonly edges: readonly string[]
}

type GraphProvenance = {
  readonly seed: string
  readonly path: readonly string[]
  readonly edges: readonly string[]
  readonly distance: number
}

const defaultDirection = 'both'
const defaultDepth = 1
const defaultLimit = 20
const defaultSeeds: readonly SeedSource[] = ['hits', 'query']
const fanOutLimit = 64
const totalCandidateLimit = 512
const rrfK = 60

/** Create a step that expands retrieved hits through visible graph relations. */
export function expandRelations(config: ExpandRelationsConfig = {}): RetrievalStep<'hits', 'hits'> {
  const direction = config.direction ?? defaultDirection
  const depth = Math.max(0, Math.floor(config.depth ?? defaultDepth))
  const limit = Math.max(0, Math.floor(config.limit ?? defaultLimit))
  const seeds = config.seeds ?? defaultSeeds

  return markBuiltInRetrievalStep(
    retrievalStep({
      id: 'expand-relations',
      phase: { in: 'hits', out: 'hits' },
      async run(input, context) {
        if (!context.knowledge) {
          throw new Error(
            'expandRelations() requires a knowledge binding. Use knowledgeBase().recipe(...) or a view recipe so graph access and visibility are bound.',
          )
        }
        if (limit === 0 || depth === 0 || seeds.length === 0) return { hits: [...input.hits] }

        const warnings: string[] = []
        const findingHits = input.hits.filter((hit) => hit.kind === 'finding')
        if (findingHits.length > 0) {
          warnings.push(`expandRelations skipped ${findingHits.length} finding hit${findingHits.length === 1 ? '' : 's'}.`)
        }
        const evidenceHits = input.hits.filter(isEvidenceHit)
        const seedRefs = [
          ...(seeds.includes('hits') ? hitSeeds(evidenceHits) : []),
          ...(seeds.includes('query') ? querySeeds(context.originalQuery, evidenceHits.length) : []),
        ]
        const incomingKeys = new Set(evidenceHits.map(hitKey))
        const candidates = new Map<string, Candidate>()
        let totalCandidates = 0
        let totalCandidateWarning = false

        for (const seed of seedRefs) {
          const seen = new Set<string>([encodeKnowledgeRef(seed.ref)])
          const queue: QueueItem[] = [{
            ref: seed.ref,
            seed: seed.ref,
            seedRank: seed.rank,
            distance: 0,
            path: [seed.ref],
            edges: [],
          }]

          for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index]
            if (!current || current.distance >= depth) continue
            const neighbors = await context.knowledge.reader.neighbors(current.ref, {
              ...(config.types ? { types: config.types } : {}),
              ...(direction === 'both' ? {} : { direction }),
              limit: fanOutLimit,
            })
            if (neighbors.length >= fanOutLimit) {
              warnings.push(`expandRelations truncated neighbors for ${encodeKnowledgeRef(current.ref)} at ${fanOutLimit}.`)
            }

            for (const neighbor of neighbors) {
              const nextDistance = current.distance + hopCost(current.ref, neighbor)
              const nextPath = [...current.path, neighbor.ref]
              const nextEdges = [...current.edges, neighbor.type]
              const encoded = encodeKnowledgeRef(neighbor.ref)
              const route: QueueItem = {
                ref: neighbor.ref,
                seed: current.seed,
                seedRank: current.seedRank,
                distance: nextDistance,
                path: nextPath,
                edges: nextEdges,
              }
              if (nextDistance <= depth && !sameRef(neighbor.ref, current.seed)) {
                const existing = candidates.get(encoded)
                if (existing) {
                  candidates.set(encoded, mergeCandidate(existing, route))
                } else if (totalCandidates < totalCandidateLimit) {
                  totalCandidates += 1
                  candidates.set(encoded, {
                    ref: neighbor.ref,
                    encoded,
                    distance: route.distance,
                    seedRank: route.seedRank,
                    support: new Set([encodeKnowledgeRef(route.seed)]),
                    path: route.path,
                    edges: route.edges,
                    discoveryRank: totalCandidates,
                  })
                } else if (!totalCandidateWarning) {
                  totalCandidateWarning = true
                  warnings.push(`expandRelations truncated graph candidates at ${totalCandidateLimit}.`)
                }
              }
              if (!seen.has(encoded) && nextDistance <= depth) {
                seen.add(encoded)
                queue.push(route)
              }
            }
          }
        }

        const additions: RetrieverHit[] = []
        const emittedKeys = new Set(incomingKeys)
        const ordered = [...candidates.values()].sort(compareCandidates)
        for (let index = 0; index < ordered.length && additions.length < limit; index += 1) {
          const candidate = ordered[index]
          if (!candidate) continue
          const hydrated = await context.knowledge.hydrate(candidate.ref)
          if (!hydrated || hydrated.kind === 'finding') continue
          const key = hitKey(hydrated)
          if (emittedKeys.has(key)) continue
          emittedKeys.add(key)
          const score = rrfScore(index + 1, candidate.seedRank + 1)
          additions.push(withGraphProvenance(hydrated, candidate, score))
        }

        return {
          hits: [...input.hits, ...additions],
          warnings,
          knowledge: context.knowledge ? {
            contributor: 'expand-relations',
            generations: [],
            coverage: 'exact',
            coverageBasis: 'visible graph neighbors from the bound knowledge reader',
            available: { reports: 0 },
            processed: { reports: 0, findings: additions.length },
          } : undefined,
        }
      },
    }),
    {
      direction,
      depth,
      limit,
      seeds: [...seeds],
      ...(config.types ? { types: [...config.types] } : {}),
    },
  )
}

function hitSeeds(hits: readonly EvidenceHit[]): Array<{ readonly ref: KnowledgeRef; readonly rank: number }> {
  return hits.map((hit, rank) => ({
    rank,
    ref: { kind: 'chunk', sourceId: hit.source.id, chunkId: hit.chunkId },
  }))
}

function querySeeds(_query: string, rankOffset: number): Array<{ readonly ref: KnowledgeRef; readonly rank: number }> {
  void rankOffset
  // Deterministic entity-name and alias matching belongs here once entity
  // records are queryable through the knowledge binding.
  return []
}

function mergeCandidate(existing: Candidate, route: QueueItem): Candidate {
  const support = new Set(existing.support)
  support.add(encodeKnowledgeRef(route.seed))
  if (compareRoute(route, existing) >= 0) return { ...existing, support }
  return {
    ...existing,
    distance: route.distance,
    seedRank: route.seedRank,
    support,
    path: route.path,
    edges: route.edges,
  }
}

function compareRoute(left: QueueItem, right: Candidate): number {
  return (
    left.distance - right.distance ||
    left.seedRank - right.seedRank ||
    encodeKnowledgeRef(left.ref).localeCompare(right.encoded)
  )
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    left.distance - right.distance ||
    left.seedRank - right.seedRank ||
    right.support.size - left.support.size ||
    left.encoded.localeCompare(right.encoded) ||
    left.discoveryRank - right.discoveryRank
  )
}

function hopCost(from: KnowledgeRef, neighbor: KnowledgeNeighbor): number {
  return from.kind === 'entity' || neighbor.ref.kind === 'entity' ? 0 : 1
}

function withGraphProvenance(hit: EvidenceHit, candidate: Candidate, score: number): EvidenceHit {
  const graph: GraphProvenance = {
    seed: encodeKnowledgeRef(candidate.path[0] ?? candidate.ref),
    path: candidate.path.map(encodeKnowledgeRef),
    edges: candidate.edges,
    distance: candidate.distance,
  }
  return {
    ...hit,
    score,
    provenance: {
      ...hit.provenance,
      rawScore: hit.provenance?.rawScore ?? hit.score,
      fusedScore: score,
      graph,
    } as EvidenceHit['provenance'] & { readonly graph: GraphProvenance },
  }
}

function rrfScore(graphRank: number, seedRank: number): number {
  return 1 / (rrfK + graphRank) + 1 / (rrfK + seedRank)
}

function hitKey(hit: EvidenceHit): string {
  return `${hit.namespace}:${hit.source.id}:${hit.chunkId}`
}

function sameRef(left: KnowledgeRef, right: KnowledgeRef): boolean {
  return encodeKnowledgeRef(left) === encodeKnowledgeRef(right)
}

function isEvidenceHit(hit: RetrieverHit): hit is EvidenceHit {
  return hit.kind !== 'finding'
}
