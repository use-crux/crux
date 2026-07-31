/**
 * Assertion resolution handles.
 *
 * @module
 */

import type { z } from 'zod'
import { stableHash } from '../../indexing/hash'
import type { KnowledgeModel } from '../model'
import type { AssertionOf, AssertionStage } from './assertions'
import type { AssertionSupport } from './identity'
import type { AssertionRelationRecord } from './relations'
import { applyModelPolicy } from './resolution-policy'
import { readAssertionSnapshot, toVisibleAssertion, visibleSupports } from './set'

/** Decision trace entry produced by assertion resolution. */
export interface AssertionResolutionTrace {
  readonly assertionId: string
  readonly partition: 'selected' | 'superseded' | 'contested' | 'unresolved'
  readonly evidence: readonly AssertionDecisionEvidence[]
}

/** Evidence cited by a resolution decision. */
export type AssertionDecisionEvidence =
  | { readonly kind: 'relation'; readonly relationId: string; readonly type: AssertionRelationRecord['type'] }
  | { readonly kind: 'policy'; readonly policyId: string; readonly note?: string }

/** Resolved assertion partitions. */
export interface AssertionResolutionResult<TItem> {
  readonly selected: readonly TItem[]
  readonly superseded: readonly TItem[]
  readonly contested: readonly TItem[]
  readonly unresolved: readonly TItem[]
  readonly trace: readonly AssertionResolutionTrace[]
}

/** Lazy resolution handle. */
export interface AssertionResolutionHandle<
  TTypes extends Record<string, z.ZodType<unknown>>,
  TSelected extends keyof TTypes & string = keyof TTypes & string,
> {
  status(): Promise<AssertionResolutionStatus>
  prepare(): Promise<void>
  result(): Promise<AssertionResolutionResult<AssertionOf<TTypes, TSelected>>>
}

/** Inspectable resolution preparation status. */
export interface AssertionResolutionStatus {
  readonly state: 'idle' | 'ready'
  readonly cached: boolean
  readonly generationId?: string
  readonly revisionHash?: string
}

/** Optional resolution policy mode. */
export type AssertionResolutionPolicy<
  TTypes extends Record<string, z.ZodType<unknown>>,
  TSelected extends keyof TTypes & string = keyof TTypes & string,
> =
  | {
      readonly id: string
      readonly version: number
      readonly model: KnowledgeModel
      readonly instructions?: string
      readonly run?: never
    }
  | {
      readonly id: string
      readonly version: number
      readonly run: (
        input: AssertionPolicyInput<AssertionOf<TTypes, TSelected>>,
        decision: AssertionPolicyDecision<AssertionOf<TTypes, TSelected>>,
      ) => void | Promise<void>
      readonly model?: never
      readonly instructions?: never
    }

/** Input supplied to deterministic assertion resolution policies. */
export interface AssertionPolicyInput<TItem> {
  readonly assertions: readonly TItem[]
  readonly relations: readonly AssertionRelationRecord[]
}

/** Decision API supplied to deterministic assertion resolution policies. */
export interface AssertionPolicyDecision<TItem> {
  select(assertion: TItem, note?: string): void
  supersede(winner: TItem, loser: TItem, note?: string): void
  contest(left: TItem, right: TItem, note?: string): void
  unresolved(assertion: TItem, note?: string): void
}

interface ResolutionFactoryConfig<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string> {
  readonly records?: import('../../storage').RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly stage: AssertionStage<TTypes>
  readonly selectedTypes?: readonly TSelected[]
  readonly resolveRevision?: () => Promise<import('../view/revision').ViewRevision>
  readonly policy?: AssertionResolutionPolicy<TTypes, TSelected>
}

type ResolutionItem = {
  readonly assertionId: string
  readonly type: string
  readonly data: unknown
  readonly evidence: readonly AssertionSupport[]
  readonly provenance: 'exact' | 'derived'
}

/** Create a lazy assertion resolution handle. Internal. */
export function createAssertionResolution<
  const TTypes extends Record<string, z.ZodType<unknown>>,
  const TSelected extends keyof TTypes & string = keyof TTypes & string,
>(config: ResolutionFactoryConfig<TTypes, TSelected>): AssertionResolutionHandle<TTypes, TSelected> {
  const cache = new Map<string, AssertionResolutionResult<AssertionOf<TTypes, TSelected>>>()
  let preparedKey: string | undefined
  let prepared: AssertionResolutionResult<AssertionOf<TTypes, TSelected>> | undefined
  let metadata: Omit<AssertionResolutionStatus, 'state' | 'cached'> = {}

  async function prepare(): Promise<void> {
    const snapshot = await readFullSnapshot(config)
    const key = stableHash({
      generationId: snapshot.generationId,
      revisionHash: snapshot.revisionHash ?? 'all',
      selectedTypes: config.selectedTypes ?? null,
      policy: policyFingerprint(config.policy),
    })
    metadata = {
      generationId: snapshot.generationId,
      ...(snapshot.revisionHash ? { revisionHash: snapshot.revisionHash } : {}),
    }
    preparedKey = key
    prepared = cache.get(key)
    if (!prepared) {
      prepared = await resolveSnapshot<TTypes, TSelected>(snapshot, config.policy)
      cache.set(key, prepared)
    }
  }

  return Object.freeze({
    status: async () => ({
      state: prepared ? 'ready' as const : 'idle' as const,
      cached: preparedKey !== undefined && cache.has(preparedKey),
      ...metadata,
    }),
    prepare,
    result: async () => {
      if (!prepared) await prepare()
      return prepared as AssertionResolutionResult<AssertionOf<TTypes, TSelected>>
    },
  })
}

async function readFullSnapshot<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string>(
  config: ResolutionFactoryConfig<TTypes, TSelected>,
) {
  if (!config.records) throw new Error('Assertion resolution requires record storage.')
  const snapshot = await readAssertionSnapshot(config)
  const selected = config.selectedTypes ? new Set<string>(config.selectedTypes) : undefined
  const members = snapshot.revision ? new Set(snapshot.revision.members.map((member) => member.sourceId)) : undefined
  const assertions: Array<AssertionOf<TTypes, TSelected>> = []
  let cursor: string | undefined
  do {
    const page = await config.records.list(snapshot.itemPrefix, { cursor, limit: 100 })
    for (const entry of page.entries) {
      const value = entry.value as unknown as { readonly _cruxRecordType?: string; readonly type?: string }
      if (value._cruxRecordType !== 'knowledge-assertion' || (selected && !selected.has(value.type ?? ''))) continue
      const item = toVisibleAssertion<TTypes, TSelected>(entry.value as never, members)
      if (item) assertions.push(item)
    }
    cursor = page.cursor
  } while (cursor)
  const visibleIds = new Set(assertions.map((assertion) => assertion.assertionId))
  const relations = snapshot.relations.flatMap((relation) => {
    if (!visibleIds.has(relation.from.assertionId) || !visibleIds.has(relation.to.assertionId)) return []
    const evidence = visibleSupports(relation.evidence, members)
    return evidence.length > 0 ? [{ ...relation, evidence }] : []
  })
  return { generationId: snapshot.generationId, revisionHash: snapshot.revision?.revisionHash, assertions, relations }
}

async function resolveSnapshot<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string>(
  snapshot: { readonly assertions: readonly AssertionOf<TTypes, TSelected>[]; readonly relations: readonly AssertionRelationRecord[] },
  policy: AssertionResolutionPolicy<TTypes, TSelected> | undefined,
): Promise<AssertionResolutionResult<AssertionOf<TTypes, TSelected>>> {
  const state = createState(snapshot.assertions)
  applyExplicitRelations(state, snapshot.relations)
  if (policy?.run) await applyRunPolicy(state, snapshot, policy)
  else if (policy?.model) await applyModelPolicy({
    assertions: snapshot.assertions,
    relations: snapshot.relations,
    policy,
    add: (partitionName, id, evidence) => add(partitionMap(state, partitionName), id, evidence),
  })
  return partition(state)
}

function createState<TItem extends ResolutionItem>(assertions: readonly TItem[]) {
  return {
    assertions,
    superseded: new Map<string, AssertionDecisionEvidence[]>(),
    contested: new Map<string, AssertionDecisionEvidence[]>(),
    unresolved: new Map<string, AssertionDecisionEvidence[]>(),
    selected: new Map<string, AssertionDecisionEvidence[]>(),
  }
}

function applyExplicitRelations<TItem extends ResolutionItem>(
  state: ReturnType<typeof createState<TItem>>,
  relations: readonly AssertionRelationRecord[],
): void {
  for (const relation of relations) {
    const evidence = { kind: 'relation' as const, relationId: relation.relationId, type: relation.type }
    if (relation.type === 'supersedes') add(state.superseded, relation.to.assertionId, evidence)
    if (relation.type === 'conflictsWith') {
      add(state.contested, relation.from.assertionId, evidence)
      add(state.contested, relation.to.assertionId, evidence)
    }
  }
}

async function applyRunPolicy<TItem extends ResolutionItem>(
  state: ReturnType<typeof createState<TItem>>,
  snapshot: { readonly assertions: readonly TItem[]; readonly relations: readonly AssertionRelationRecord[] },
  policy: {
    readonly id: string
    readonly run: (input: AssertionPolicyInput<TItem>, decision: AssertionPolicyDecision<TItem>) => void | Promise<void>
  },
): Promise<void> {
  const policyEvidence = (note?: string): AssertionDecisionEvidence => ({ kind: 'policy', policyId: policy.id, ...(note ? { note } : {}) })
  const decision: AssertionPolicyDecision<TItem> = {
    select: (assertion, note) => add(state.selected, assertion.assertionId, policyEvidence(note)),
    supersede: (_winner, loser, note) => add(state.superseded, loser.assertionId, policyEvidence(note)),
    contest: (left, right, note) => {
      add(state.contested, left.assertionId, policyEvidence(note))
      add(state.contested, right.assertionId, policyEvidence(note))
    },
    unresolved: (assertion, note) => add(state.unresolved, assertion.assertionId, policyEvidence(note)),
  }
  await policy.run(snapshot, decision)
}

function partition<TItem extends ResolutionItem>(
  state: ReturnType<typeof createState<TItem>>,
): AssertionResolutionResult<TItem> {
  const selected: TItem[] = [], superseded: TItem[] = [], contested: TItem[] = [], unresolved: TItem[] = []
  const trace: AssertionResolutionTrace[] = []
  for (const assertion of state.assertions) {
    const id = assertion.assertionId
    const partitionName = state.unresolved.has(id) ? 'unresolved' : state.superseded.has(id) ? 'superseded' : state.contested.has(id) ? 'contested' : 'selected'
    if (partitionName === 'unresolved') unresolved.push(assertion)
    else if (partitionName === 'superseded') superseded.push(assertion)
    else if (partitionName === 'contested') contested.push(assertion)
    else selected.push(assertion)
    trace.push({ assertionId: id, partition: partitionName, evidence: evidenceFor(state, id, partitionName) })
  }
  return { selected, superseded, contested, unresolved, trace }
}

function evidenceFor<TItem extends ResolutionItem>(
  state: ReturnType<typeof createState<TItem>>,
  id: string,
  partitionName: AssertionResolutionTrace['partition'],
): readonly AssertionDecisionEvidence[] {
  if (partitionName === 'unresolved') return state.unresolved.get(id) ?? []
  if (partitionName === 'superseded') return state.superseded.get(id) ?? []
  if (partitionName === 'contested') return state.contested.get(id) ?? []
  return state.selected.get(id) ?? []
}

function add(map: Map<string, AssertionDecisionEvidence[]>, id: string, evidence: AssertionDecisionEvidence): void {
  map.set(id, [...(map.get(id) ?? []), evidence])
}

function partitionMap<TItem extends ResolutionItem>(
  state: ReturnType<typeof createState<TItem>>,
  partitionName: AssertionResolutionTrace['partition'],
): Map<string, AssertionDecisionEvidence[]> {
  if (partitionName === 'selected') return state.selected
  if (partitionName === 'superseded') return state.superseded
  if (partitionName === 'contested') return state.contested
  return state.unresolved
}

function policyFingerprint<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string>(
  policy: AssertionResolutionPolicy<TTypes, TSelected> | undefined,
): unknown {
  if (!policy) return { mode: 'explicit' }
  if ('model' in policy && policy.model) {
    return { id: policy.id, version: policy.version, mode: 'model', model: { name: policy.model.name, fingerprint: policy.model.fingerprint }, instructions: policy.instructions ?? null }
  }
  return { id: policy.id, version: policy.version, mode: 'run' }
}
