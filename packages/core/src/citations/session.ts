/**
 * Per-generation grounding evidence accumulator.
 *
 * A grounding session records the retrieval hits that were made available to a
 * model through injected context or typed retrieval tool results. Citation
 * validation reads the session at validation time so late tool calls and
 * serialized transcript rehydration are reflected consistently.
 *
 * @module
 */

import type { EvidenceHit, RetrieverHit } from '../retrieval/types'

/** How a hit became citeable during grounded generation. */
export type GroundingHitOrigin = 'injected' | 'tool'

/** Accumulates citeable hits for one grounded generation. */
export interface GroundingSession {
  /** Stable generation id used by adapters when reconstructing evidence. */
  readonly generationId: string
  /**
   * Record hits that were exposed to the model.
   *
   * Implementations deduplicate by `namespace`/`sourceId`/`chunkId`; the first
   * recorded hit wins so context ordering and original scores stay stable.
   */
  recordHits(hits: readonly RetrieverHit[], origin: GroundingHitOrigin): void | Promise<void>
  /** Return all citeable hits, deduplicated by source identity. */
  allowedHits(): readonly EvidenceHit[] | Promise<readonly EvidenceHit[]>
}

/** Create the default in-memory grounding session for single-process runtimes. */
export function createGroundingSession(args: { generationId?: string } = {}): GroundingSession {
  const hits = new Map<string, EvidenceHit>()

  return Object.freeze({
    generationId: args.generationId ?? createGenerationId(),
    recordHits(nextHits: readonly RetrieverHit[]): void {
      for (const hit of nextHits) {
        if (hit.kind === 'finding') continue
        const key = groundingHitKey(hit)
        if (!hits.has(key)) hits.set(key, hit)
      }
    },
    allowedHits(): readonly EvidenceHit[] {
      return [...hits.values()]
    },
  }) satisfies GroundingSession
}

/** Build the stable deduplication identity for a citeable hit. */
export function groundingHitKey(hit: Pick<EvidenceHit, 'namespace' | 'source' | 'chunkId'>): string {
  return `${hit.namespace}:${hit.source.id}:${hit.chunkId}`
}

function createGenerationId(): string {
  return `grounding_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
