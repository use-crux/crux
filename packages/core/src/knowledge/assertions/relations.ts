/**
 * Assertion relation contracts and identity helpers.
 *
 * Assertion relations connect persisted assertions without entering the
 * knowledge graph traversed by relation expansion.
 *
 * @module
 */

import type { JsonObject, JsonValue } from '../../storage'
import { createStableId } from '../../indexing/hash'
import type { AssertionSupport } from './identity'

/** A reference to one canonical persisted assertion. */
export interface AssertionRef extends JsonObject {
  /** Stable assertion id. */
  readonly assertionId: string
}

/** Closed assertion relation vocabulary used by resolution. */
export type AssertionRelationType =
  | 'supports'
  | 'amends'
  | 'supersedes'
  | 'narrows'
  | 'conflictsWith'

/** Persisted relation between two assertions in one assertion generation. */
export interface AssertionRelationRecord {
  readonly _cruxRecordType: 'knowledge-assertion-relation'
  readonly relationId: string
  readonly type: AssertionRelationType
  readonly from: AssertionRef
  readonly to: AssertionRef
  readonly evidence: readonly AssertionSupport[]
  readonly provenance: 'exact' | 'derived'
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly generationId: string
  readonly namespace: string
  readonly direction: 'directed'
  readonly createdAt: number
  readonly updatedAt: number
}

/** Canonical assertion identity input accepted by assertion relation emitters. */
export interface AssertionIdentityRefInput<TType extends string = string, TData = unknown> {
  readonly type: TType
  readonly data: TData
}

/** Create a stable id for a persisted assertion relation. */
export function createAssertionRelationId(input: {
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly type: AssertionRelationType
  readonly from: AssertionRef
  readonly to: AssertionRef
  readonly evidence: readonly AssertionSupport[]
}): string {
  return createStableId('assertion-relation', {
    stageId: input.stageId,
    stageVersion: input.stageVersion,
    stageFingerprint: input.stageFingerprint,
    type: input.type,
    from: input.from.assertionId,
    to: input.to.assertionId,
    evidence: input.evidence.map((support) => ({
      sourceId: support.sourceId,
      chunkRef: support.chunkRef,
      provenance: support.provenance,
    })),
  } satisfies JsonValue)
}

/** Narrow arbitrary stored JSON to an assertion relation record. Internal. */
export function isAssertionRelationRecord(value: unknown): value is AssertionRelationRecord {
  return isRecord(value) &&
    value._cruxRecordType === 'knowledge-assertion-relation' &&
    typeof value.relationId === 'string' &&
    isAssertionRelationType(value.type) &&
    isAssertionRef(value.from) &&
    isAssertionRef(value.to) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isAssertionSupport) &&
    (value.provenance === 'exact' || value.provenance === 'derived') &&
    typeof value.stageId === 'string' &&
    typeof value.stageVersion === 'number' &&
    typeof value.stageFingerprint === 'string' &&
    typeof value.generationId === 'string' &&
    typeof value.namespace === 'string' &&
    value.direction === 'directed' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
}

function isAssertionRelationType(value: unknown): value is AssertionRelationType {
  return value === 'supports' ||
    value === 'amends' ||
    value === 'supersedes' ||
    value === 'narrows' ||
    value === 'conflictsWith'
}

function isAssertionRef(value: unknown): value is AssertionRef {
  return isRecord(value) && typeof value.assertionId === 'string'
}

function isAssertionSupport(value: unknown): value is AssertionSupport {
  return isRecord(value) &&
    typeof value.sourceId === 'string' &&
    isRecord(value.chunkRef) &&
    value.chunkRef.kind === 'chunk' &&
    typeof value.chunkRef.sourceId === 'string' &&
    typeof value.chunkRef.chunkId === 'string' &&
    (value.provenance === 'exact' || value.provenance === 'derived')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
