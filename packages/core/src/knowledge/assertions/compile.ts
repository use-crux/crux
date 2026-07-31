/**
 * Assertion claim compilation into generation-scoped records.
 *
 * @module
 */

import { indexedNamespacePrefix, listIndexedEntries } from '../../indexed-knowledge/keys'
import type { JsonObject, RecordEntry, RecordStore } from '../../storage'
import { isAssertionClaimRecord, type AssertionClaimRecord } from '../derive/assertion-claims'
import { knowledgeAssertionsItemKey } from '../keys'
import { encodeKnowledgeRef } from '../refs'
import type { buildClaimTargetIndex } from '../derive/targets'
import {
  createAssertionIdentity,
  normalizeAssertionData,
  type AssertionSupport,
  type KnowledgeAssertionRecord,
} from './identity'

/** Compile assertion claims into generation-scoped assertion records. Internal. */
export async function compileAssertionRecords(input: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly generationId: string
  readonly now: number
  readonly targets: Awaited<ReturnType<typeof buildClaimTargetIndex>>
}): Promise<readonly KnowledgeAssertionRecord[]> {
  const groups = new Map<string, AssertionGroup>()
  const entries = await readAssertionClaimEntries(input.records, input.indexerId, input.namespace)
  for (const entry of entries) {
    const claim = entry.value as AssertionClaimRecord
    const supports = resolveSupports(claim, input.targets)
    if (supports.length === 0) continue
    const assertionId = createAssertionIdentity({
      stageId: claim.stageId,
      stageVersion: claim.stageVersion,
      stageFingerprint: claim.stageFingerprint,
      type: claim.type,
      data: claim.data,
    })
    const existing = groups.get(assertionId)
    if (existing) mergeSupports(existing, supports)
    else groups.set(assertionId, createGroup(assertionId, claim, supports))
  }

  const assertions = [...groups.values()].map((group) => ({
    _cruxRecordType: 'knowledge-assertion' as const,
    assertionId: group.assertionId,
    type: group.type,
    data: normalizeAssertionData(group.data),
    evidence: [...group.supports.values()].sort(compareSupports),
    stageId: group.stageId,
    stageVersion: group.stageVersion,
    stageFingerprint: group.stageFingerprint,
    generationId: input.generationId,
    namespace: input.namespace,
    createdAt: input.now,
    updatedAt: input.now,
  })).sort((left, right) => left.assertionId.localeCompare(right.assertionId))

  for (const assertion of assertions) {
    await input.records.put(knowledgeAssertionsItemKey(
      input.indexerId,
      input.namespace,
      assertion.stageId,
      input.generationId,
      assertion.assertionId,
    ), assertion as unknown as JsonObject)
  }

  return assertions
}

/** Remove assertion records that do not belong to the current generation. Internal. */
export async function cleanupStaleAssertionRecords(input: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly generationId: string
}): Promise<void> {
  const entries = await listIndexedEntries(input.records, `${indexedNamespacePrefix(input.indexerId, input.namespace)}assertions:`)
  await Promise.all(entries
    .filter((entry) => !entry.key.includes(`:gen:${input.generationId}:`))
    .map((entry) => input.records.delete(entry.key)))
}

type AssertionGroup = {
  readonly assertionId: string
  readonly type: string
  readonly data: AssertionClaimRecord['data']
  readonly stageId: string
  readonly stageVersion: number
  readonly stageFingerprint: string
  readonly supports: Map<string, AssertionSupport>
}

async function readAssertionClaimEntries(
  records: RecordStore,
  indexerId: string,
  namespace: string,
): Promise<readonly RecordEntry[]> {
  const entries = await listIndexedEntries(records, `${indexedNamespacePrefix(indexerId, namespace)}claims:`)
  return entries
    .filter((entry) => isAssertionClaimRecord(entry.value))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function resolveSupports(
  claim: AssertionClaimRecord,
  targets: Awaited<ReturnType<typeof buildClaimTargetIndex>>,
): readonly AssertionSupport[] {
  return claim.evidence.flatMap((encoded) => {
    const resolved = targets.resolve(encoded)
    if (resolved.status !== 'resolved' || resolved.ref.kind !== 'chunk') return []
    return [{ sourceId: claim.sourceId, chunkRef: resolved.ref, provenance: claim.provenance }]
  })
}

function createGroup(
  assertionId: string,
  claim: AssertionClaimRecord,
  supports: readonly AssertionSupport[],
): AssertionGroup {
  const group: AssertionGroup = {
    assertionId,
    type: claim.type,
    data: claim.data,
    stageId: claim.stageId,
    stageVersion: claim.stageVersion,
    stageFingerprint: claim.stageFingerprint,
    supports: new Map(),
  }
  mergeSupports(group, supports)
  return group
}

function mergeSupports(group: AssertionGroup, supports: readonly AssertionSupport[]): void {
  for (const support of supports) group.supports.set(supportKey(support), support)
}

function supportKey(support: AssertionSupport): string {
  return `${support.sourceId}:${encodeKnowledgeRef(support.chunkRef)}:${support.provenance}`
}

function compareSupports(left: AssertionSupport, right: AssertionSupport): number {
  return supportKey(left).localeCompare(supportKey(right))
}
