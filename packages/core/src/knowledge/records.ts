/**
 * Record codecs for connected knowledge edges and entities.
 *
 * These functions translate between connected knowledge domain records and
 * persisted JSON values while keeping raw stored value validation local to
 * this module.
 *
 * @module
 */

import { createStableId } from '../indexing/hash'
import type { KnowledgeRef } from './refs'
import { encodeKnowledgeRef, isKnowledgeRef } from './refs'

const knowledgeRecordTypes = {
  edge: 'knowledge-edge',
  entity: 'knowledge-entity',
} as const

const maxDescriptionLength = 2000

/** Direction semantics for a persisted {@link KnowledgeEdgeRecord}. */
export type KnowledgeEdgeDirection = 'directed' | 'symmetric'

/** Provenance mode for a persisted {@link KnowledgeEdgeEvidenceSupport}. */
export type KnowledgeEvidenceProvenance = 'exact' | 'derived'

/** A chunk-level evidence support for a persisted {@link KnowledgeEdgeRecord}. */
export interface KnowledgeEdgeEvidenceSupport {
  readonly sourceId: string
  readonly chunkRef: Extract<KnowledgeRef, { readonly kind: 'chunk' }>
  readonly provenance: KnowledgeEvidenceProvenance
}

/** Persisted connected knowledge edge record. */
export interface KnowledgeEdgeRecord {
  readonly _cruxRecordType: 'knowledge-edge'
  readonly edgeId: string
  readonly type: string
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly direction: KnowledgeEdgeDirection
  readonly description?: string
  readonly evidence: readonly KnowledgeEdgeEvidenceSupport[]
  readonly stageId: string
  readonly stageVersion: number
  readonly generationId: string
  readonly namespace: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Persisted connected knowledge entity record. */
export interface KnowledgeEntityRecord {
  readonly _cruxRecordType: 'knowledge-entity'
  readonly entityId: string
  readonly canonicalName: string
  readonly aliases: readonly string[]
  readonly description?: string
  readonly generationId: string
  readonly namespace: string
}

/** Create the persisted JSON value for a connected knowledge edge. */
export function createKnowledgeEdgeRecord(input: {
  readonly type: string
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly direction: KnowledgeEdgeDirection
  readonly description?: string
  readonly evidence: readonly KnowledgeEdgeEvidenceSupport[]
  readonly stageId: string
  readonly stageVersion: number
  readonly generationId: string
  readonly namespace: string
  readonly now: number
}): KnowledgeEdgeRecord {
  const endpoints = normalizeEdgeEndpoints(input.from, input.to, input.direction)
  return {
    _cruxRecordType: knowledgeRecordTypes.edge,
    edgeId: createKnowledgeEdgeId({
      type: input.type,
      from: endpoints.from,
      to: endpoints.to,
      direction: input.direction,
      stageId: input.stageId,
      stageVersion: input.stageVersion,
    }),
    type: input.type,
    from: endpoints.from,
    to: endpoints.to,
    direction: input.direction,
    ...(isBoundedDescription(input.description) ? { description: input.description } : {}),
    evidence: input.evidence.map((support) => ({ ...support })),
    stageId: input.stageId,
    stageVersion: input.stageVersion,
    generationId: input.generationId,
    namespace: input.namespace,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/** Create the persisted JSON value for a connected knowledge entity. */
export function createKnowledgeEntityRecord(input: {
  readonly entityId: string
  readonly canonicalName: string
  readonly aliases: readonly string[]
  readonly description?: string
  readonly generationId: string
  readonly namespace: string
}): KnowledgeEntityRecord {
  return {
    _cruxRecordType: knowledgeRecordTypes.entity,
    entityId: input.entityId,
    canonicalName: input.canonicalName,
    aliases: [...input.aliases],
    ...(isBoundedDescription(input.description) ? { description: input.description } : {}),
    generationId: input.generationId,
    namespace: input.namespace,
  }
}

/** Narrow an arbitrary stored value to a persisted {@link KnowledgeEdgeRecord}. */
export function asKnowledgeEdgeRecord(value: unknown): KnowledgeEdgeRecord | null {
  if (
    !isRecord(value) ||
    value._cruxRecordType !== knowledgeRecordTypes.edge ||
    typeof value.edgeId !== 'string' ||
    typeof value.type !== 'string' ||
    !isKnowledgeRef(value.from) ||
    !isKnowledgeRef(value.to) ||
    !isKnowledgeEdgeDirection(value.direction) ||
    !isOptionalBoundedDescription(value.description) ||
    !Array.isArray(value.evidence) ||
    typeof value.stageId !== 'string' ||
    !isFiniteNumber(value.stageVersion) ||
    typeof value.generationId !== 'string' ||
    typeof value.namespace !== 'string' ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return null
  }

  const evidence = value.evidence.map(asKnowledgeEdgeEvidenceSupport)
  if (evidence.some((support) => support === null)) return null

  return {
    _cruxRecordType: knowledgeRecordTypes.edge,
    edgeId: value.edgeId,
    type: value.type,
    from: value.from,
    to: value.to,
    direction: value.direction,
    ...(value.description !== undefined ? { description: value.description } : {}),
    evidence: evidence as readonly KnowledgeEdgeEvidenceSupport[],
    stageId: value.stageId,
    stageVersion: value.stageVersion,
    generationId: value.generationId,
    namespace: value.namespace,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

/** Narrow an arbitrary stored value to a persisted {@link KnowledgeEntityRecord}. */
export function asKnowledgeEntityRecord(value: unknown): KnowledgeEntityRecord | null {
  if (
    !isRecord(value) ||
    value._cruxRecordType !== knowledgeRecordTypes.entity ||
    typeof value.entityId !== 'string' ||
    typeof value.canonicalName !== 'string' ||
    !Array.isArray(value.aliases) ||
    !value.aliases.every((alias) => typeof alias === 'string') ||
    !isOptionalBoundedDescription(value.description) ||
    typeof value.generationId !== 'string' ||
    typeof value.namespace !== 'string'
  ) {
    return null
  }

  return {
    _cruxRecordType: knowledgeRecordTypes.entity,
    entityId: value.entityId,
    canonicalName: value.canonicalName,
    aliases: value.aliases,
    ...(value.description !== undefined ? { description: value.description } : {}),
    generationId: value.generationId,
    namespace: value.namespace,
  }
}

function createKnowledgeEdgeId(input: {
  readonly type: string
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly direction: KnowledgeEdgeDirection
  readonly stageId: string
  readonly stageVersion: number
}): string {
  const endpoints = normalizeEdgeEndpoints(input.from, input.to, input.direction)
  return createStableId('edge', {
    type: input.type,
    from: encodeKnowledgeRef(endpoints.from),
    to: encodeKnowledgeRef(endpoints.to),
    direction: input.direction,
    stageId: input.stageId,
    stageVersion: input.stageVersion,
  })
}

function normalizeEdgeEndpoints(
  from: KnowledgeRef,
  to: KnowledgeRef,
  direction: KnowledgeEdgeDirection,
): { readonly from: KnowledgeRef; readonly to: KnowledgeRef } {
  if (direction === 'directed') return { from, to }

  const encodedFrom = encodeKnowledgeRef(from)
  const encodedTo = encodeKnowledgeRef(to)
  return encodedFrom <= encodedTo ? { from, to } : { from: to, to: from }
}

function asKnowledgeEdgeEvidenceSupport(value: unknown): KnowledgeEdgeEvidenceSupport | null {
  if (
    !isRecord(value) ||
    typeof value.sourceId !== 'string' ||
    !isKnowledgeRef(value.chunkRef) ||
    value.chunkRef.kind !== 'chunk' ||
    !isKnowledgeEvidenceProvenance(value.provenance)
  ) {
    return null
  }
  return {
    sourceId: value.sourceId,
    chunkRef: value.chunkRef,
    provenance: value.provenance,
  }
}

function isKnowledgeEdgeDirection(value: unknown): value is KnowledgeEdgeDirection {
  return value === 'directed' || value === 'symmetric'
}

function isKnowledgeEvidenceProvenance(value: unknown): value is KnowledgeEvidenceProvenance {
  return value === 'exact' || value === 'derived'
}

function isOptionalBoundedDescription(value: unknown): value is string | undefined {
  return value === undefined || isBoundedDescription(value)
}

function isBoundedDescription(value: unknown): value is string {
  return typeof value === 'string' && value.length <= maxDescriptionLength
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
