import type {
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeSynchronization,
  RuntimeEffectScopeTransition,
  RuntimeEffectUnitTransition,
} from '@use-crux/core/runtime'
import {
  durableTransitionMatches,
  isDurableScopeSynchronization,
  isDurableScopeTransition,
  isDurableUnitRegistration,
  isDurableUnitTransition,
} from '@use-crux/core/runtime/internal/effects-store'
import type { DurableEffectScopeRecord } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import type { Doc } from '../_generated/dataModel.js'
import {
  getEffectDocument,
  insertEffectRecord,
  replaceEffectRecord,
} from './effect_records'

export async function transitionEffectScope(
  ctx: MutationCtx,
  { next }: RuntimeEffectScopeTransition,
): Promise<DurableEffectScopeRecord | null> {
  const current = await getEffectDocument(
    ctx, 'scope', next.namespace, next.scope.ref.id,
  )
  const value = current?.record as DurableEffectScopeRecord | undefined
  if (!current || !value ||
    !durableTransitionMatches(value, next) ||
    !isDurableScopeTransition(value.scope.status, next.scope.status)) return null
  return await replaceEffectRecord(ctx, current, next.scope.ref.id, next)
    ? next
    : null
}

export async function synchronizeEffectScope(
  ctx: MutationCtx,
  synchronization: DurableEffectScopeSynchronization,
): Promise<DurableEffectScopeSynchronization | null> {
  const nextScope = synchronization.scope
  const scopeId = nextScope.scope.ref.id
  const scopeDocument = await getEffectDocument(
    ctx, 'scope', nextScope.namespace, scopeId,
  )
  const currentScope = scopeDocument?.record as
    | DurableEffectScopeRecord
    | undefined
  const unitDocuments: Array<Doc<'runtimeEffectRecords'> | null> = []
  for (const unit of synchronization.units) {
    unitDocuments.push(await getEffectDocument(
      ctx, 'unit', unit.namespace, unit.unit.id,
    ))
  }
  if (!isDurableScopeSynchronization(currentScope, nextScope) ||
    synchronization.units.some((unit, index) =>
      !isDurableUnitRegistration(
        nextScope.scope.ref,
        unitDocuments[index]?.record as DurableEffectRecoveryUnitRecord | undefined,
        unit,
      ))) return null
  const stored = scopeDocument
    ? await replaceEffectRecord(ctx, scopeDocument, scopeId, nextScope)
    : await insertEffectRecord(ctx, 'scope', scopeId, scopeId, nextScope)
  if (!stored) return null
  for (const unit of synchronization.units) {
    if (!(await insertEffectRecord(
      ctx, 'unit', unit.unit.id, unit.unit.boundaryId, unit,
    ))) return null
  }
  return synchronization
}

export async function transitionEffectUnit(
  ctx: MutationCtx,
  { next }: RuntimeEffectUnitTransition,
): Promise<DurableEffectRecoveryUnitRecord | null> {
  const current = await getEffectDocument(
    ctx, 'unit', next.namespace, next.unit.id,
  )
  const value = current?.record as DurableEffectRecoveryUnitRecord | undefined
  if (!current || !value ||
    !durableTransitionMatches(value, next) ||
    !isDurableUnitTransition(value.unit.status, next.unit.status)) return null
  return await replaceEffectRecord(ctx, current, next.unit.boundaryId, next)
    ? next
    : null
}
