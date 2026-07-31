/**
 * Claim compilation into published connected knowledge generations.
 *
 * @module
 */

import { createGenerationId } from '../indexing/hash'
import { indexedNamespacePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import type { JsonObject, RecordEntry, RecordStore } from '../storage'
import { createKnowledgeGenerationStore, type KnowledgeGenerationRetention } from './generation'
import {
  knowledgeAdjacencyInKey,
  knowledgeAdjacencyOutKey,
  knowledgeClaimsKey,
} from './keys'
import {
  createKnowledgeEdgeRecord,
  createKnowledgeEntityRecord,
  type KnowledgeEdgeDirection,
  type KnowledgeEdgeEvidenceSupport,
  type KnowledgeEdgeRecord,
  type KnowledgeEntityRecord,
} from './records'
import { encodeKnowledgeRef, type KnowledgeRef } from './refs'
import { buildClaimTargetIndex } from './derive/targets'
import { isClaimRecord, type ClaimRecord } from './derive/claims'

/** Input for compiling persisted claims into one graph generation. */
export interface CompileKnowledgeGenerationInput {
  /** Store containing indexed records and cached claims. */
  readonly records: RecordStore
  /** Indexer id used by indexed and knowledge records. */
  readonly indexerId: string
  /** Namespace to compile. */
  readonly namespace: string
  /** Retention policy for the replaced graph generation. */
  readonly retention?: KnowledgeGenerationRetention
}

/** Summary returned after claim compilation publishes a generation. */
export interface CompileKnowledgeGenerationResult {
  /** Published generation id. */
  readonly generationId: string
  /** Edge records written to the published generation. */
  readonly edges: readonly KnowledgeEdgeRecord[]
  /** Entity records written to the published generation. */
  readonly entities: readonly KnowledgeEntityRecord[]
  /** Claims that could not resolve into an edge in this compile. */
  readonly pendingClaims: readonly ClaimRecord[]
}

/** Compile every persisted claim in a namespace into a published graph generation. */
export async function compileKnowledgeGeneration(
  input: CompileKnowledgeGenerationInput,
): Promise<CompileKnowledgeGenerationResult> {
  const targetIndex = await buildClaimTargetIndex(input)
  const claimEntries = await readClaimEntries(input.records, input.indexerId, input.namespace)
  const groups = new Map<string, EdgeGroup>()
  const claimStatuses: Array<{ readonly entry: RecordEntry; readonly status: ClaimRecord['status'] }> = []
  const pendingClaims: ClaimRecord[] = []

  for (const entry of claimEntries) {
    const claim = entry.value as ClaimRecord
    const resolved = resolveClaim(claim, targetIndex)
    if (!resolved) {
      pendingClaims.push({ ...claim, status: 'pending' })
      claimStatuses.push({ entry, status: 'pending' })
      continue
    }
    const key = edgeGroupKey(resolved)
    const existing = groups.get(key)
    if (existing) mergeEdgeGroup(existing, resolved)
    else groups.set(key, createEdgeGroup(resolved))
    claimStatuses.push({ entry, status: 'ready' })
  }

  for (const item of claimStatuses) {
    await input.records.put(item.entry.key, { ...item.entry.value, status: item.status })
  }

  const generationId = createGenerationId()
  const now = Date.now()
  const edges = [...groups.values()].map((group) => createKnowledgeEdgeRecord({
    type: group.type,
    from: group.from,
    to: group.to,
    direction: group.direction,
    ...(group.description ? { description: group.description } : {}),
    evidence: [...group.supports.values()].sort(compareSupports),
    stageId: group.stageId,
    stageVersion: group.stageVersion,
    generationId,
    namespace: input.namespace,
    now,
  })).sort((left, right) => left.edgeId.localeCompare(right.edgeId))
  const entities = createEntities(edges, generationId, input.namespace)
  const generationStore = createKnowledgeGenerationStore({
    records: input.records,
    indexerId: input.indexerId,
    namespace: input.namespace,
    retention: input.retention,
  })
  const writer = generationStore.beginGeneration(generationId)

  for (const edge of edges) {
    await writer.putEdge(edge)
    await writeAdjacency(input, writer, edge)
  }
  for (const entity of entities) await writer.putEntity(entity)
  await writer.finish()
  await generationStore.publish(generationId, { retention: input.retention })

  return { generationId, edges, entities, pendingClaims }
}

/** Delete cached claim records for one removed source. */
export async function deleteKnowledgeClaimsForSource(input: {
  readonly records: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly sourceId: string
  readonly stageIds?: readonly string[]
}): Promise<number> {
  const prefixes = input.stageIds?.length
    ? input.stageIds.map((stageId) => knowledgeClaimsKey(input.indexerId, input.namespace, stageId, input.sourceId, ''))
    : [`${indexedNamespacePrefix(input.indexerId, input.namespace)}claims:`]
  let deleted = 0
  for (const prefix of prefixes) {
    const entries = await listIndexedEntries(input.records, prefix)
    const selected = input.stageIds?.length
      ? entries
      : entries.filter((entry) => entry.key.includes(`:source:${input.sourceId}:`))
    for (const entry of selected) {
      await input.records.delete(entry.key)
      deleted += 1
    }
  }
  return deleted
}

type TargetIndex = Awaited<ReturnType<typeof buildClaimTargetIndex>>

type ResolvedClaim = {
  readonly claim: ClaimRecord
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly direction: KnowledgeEdgeDirection
  readonly supports: readonly KnowledgeEdgeEvidenceSupport[]
}

type EdgeGroup = {
  readonly stageId: string
  readonly stageVersion: number
  readonly type: string
  readonly from: KnowledgeRef
  readonly to: KnowledgeRef
  readonly direction: KnowledgeEdgeDirection
  description?: string
  readonly supports: Map<string, KnowledgeEdgeEvidenceSupport>
}

async function readClaimEntries(
  records: RecordStore,
  indexerId: string,
  namespace: string,
): Promise<readonly RecordEntry[]> {
  const entries = await listIndexedEntries(records, `${indexedNamespacePrefix(indexerId, namespace)}claims:`)
  return entries
    .filter((entry) => isClaimRecord(entry.value))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function resolveClaim(claim: ClaimRecord, targets: TargetIndex): ResolvedClaim | null {
  const from = targets.resolve(claim.from)
  const to = targets.resolve(claim.to)
  if (from.status !== 'resolved' || to.status !== 'resolved') return null
  const supports = claim.evidence.flatMap((encoded) => {
    const resolved = targets.resolve(encoded)
    if (resolved.status !== 'resolved' || resolved.ref.kind !== 'chunk') return []
    return [{
      sourceId: claim.sourceId,
      chunkRef: resolved.ref,
      provenance: claim.provenance,
    }]
  })
  if (supports.length === 0) return null
  return {
    claim,
    from: from.ref,
    to: to.ref,
    direction: claim.direction ?? 'directed',
    supports,
  }
}

function createEdgeGroup(resolved: ResolvedClaim): EdgeGroup {
  const endpoints = normalizeEndpoints(resolved.from, resolved.to, resolved.direction)
  const supports = new Map<string, KnowledgeEdgeEvidenceSupport>()
  for (const support of resolved.supports) supports.set(supportKey(support), support)
  return {
    stageId: resolved.claim.stageId,
    stageVersion: resolved.claim.stageVersion,
    type: resolved.claim.type,
    from: endpoints.from,
    to: endpoints.to,
    direction: resolved.direction,
    ...(resolved.claim.description ? { description: resolved.claim.description } : {}),
    supports,
  }
}

function mergeEdgeGroup(group: EdgeGroup, resolved: ResolvedClaim): void {
  for (const support of resolved.supports) group.supports.set(supportKey(support), support)
  if (!group.description && resolved.claim.description) group.description = resolved.claim.description
}

function edgeGroupKey(resolved: ResolvedClaim): string {
  const endpoints = normalizeEndpoints(resolved.from, resolved.to, resolved.direction)
  return [
    resolved.claim.stageId,
    resolved.claim.stageVersion,
    resolved.claim.type,
    resolved.direction,
    encodeKnowledgeRef(endpoints.from),
    encodeKnowledgeRef(endpoints.to),
  ].join('\0')
}

function normalizeEndpoints(
  from: KnowledgeRef,
  to: KnowledgeRef,
  direction: KnowledgeEdgeDirection,
): { readonly from: KnowledgeRef; readonly to: KnowledgeRef } {
  if (direction === 'directed') return { from, to }
  return encodeKnowledgeRef(from) <= encodeKnowledgeRef(to) ? { from, to } : { from: to, to: from }
}

async function writeAdjacency(
  input: CompileKnowledgeGenerationInput,
  writer: ReturnType<ReturnType<typeof createKnowledgeGenerationStore>['beginGeneration']>,
  edge: KnowledgeEdgeRecord,
): Promise<void> {
  await writePointer(input, writer, edge, edge.from, edge.to, 'out')
  await writePointer(input, writer, edge, edge.to, edge.from, 'in')
  if (edge.direction === 'symmetric') {
    await writePointer(input, writer, edge, edge.to, edge.from, 'out')
    await writePointer(input, writer, edge, edge.from, edge.to, 'in')
  }
}

async function writePointer(
  input: CompileKnowledgeGenerationInput,
  writer: ReturnType<ReturnType<typeof createKnowledgeGenerationStore>['beginGeneration']>,
  edge: KnowledgeEdgeRecord,
  ref: KnowledgeRef,
  peerRef: KnowledgeRef,
  direction: 'out' | 'in',
): Promise<void> {
  const key = direction === 'out'
    ? knowledgeAdjacencyOutKey(input.indexerId, input.namespace, edge.generationId, ref, edge.type, edge.edgeId)
    : knowledgeAdjacencyInKey(input.indexerId, input.namespace, edge.generationId, ref, edge.type, edge.edgeId)
  await writer.putRecord(key, { edgeId: edge.edgeId, type: edge.type, peerRef } as unknown as JsonObject)
}

function createEntities(
  edges: readonly KnowledgeEdgeRecord[],
  generationId: string,
  namespace: string,
): readonly KnowledgeEntityRecord[] {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edge.from.kind === 'entity') ids.add(edge.from.entityId)
    if (edge.to.kind === 'entity') ids.add(edge.to.entityId)
  }
  return [...ids].sort().map((entityId) => createKnowledgeEntityRecord({
    entityId,
    canonicalName: entityId,
    aliases: [],
    generationId,
    namespace,
  }))
}

function supportKey(support: KnowledgeEdgeEvidenceSupport): string {
  return `${support.sourceId}:${encodeKnowledgeRef(support.chunkRef)}:${support.provenance}`
}

function compareSupports(left: KnowledgeEdgeEvidenceSupport, right: KnowledgeEdgeEvidenceSupport): number {
  return supportKey(left).localeCompare(supportKey(right))
}
