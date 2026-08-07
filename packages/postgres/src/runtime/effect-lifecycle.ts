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
import type { PostgresStoreFaults } from './faults'
import {
  getEffectRecord,
  insertEffectRecord,
  replaceEffectRecord,
} from './effect-records'
import type { PgExecutor } from './sql'

export async function transitionPostgresEffectScope(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  { next }: RuntimeEffectScopeTransition,
): Promise<DurableEffectScopeRecord | null> {
  const current = await getEffectRecord<DurableEffectScopeRecord>(
    db, records, 'scope', next.namespace, next.scope.ref.id, true,
  )
  if (
    !current ||
    !durableTransitionMatches(current, next) ||
    !isDurableScopeTransition(current.scope.status, next.scope.status)
  ) return null
  return await replaceEffectRecord(
    db, records, 'scope', next.scope.ref.id, next.scope.ref.id,
    current.revision, next, faults,
  ) ? next : null
}

export async function synchronizePostgresEffectScope(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  synchronization: DurableEffectScopeSynchronization,
): Promise<DurableEffectScopeSynchronization | null> {
  const nextScope = synchronization.scope
  const scopeId = nextScope.scope.ref.id
  const currentScope = await getEffectRecord<DurableEffectScopeRecord>(
    db, records, 'scope', nextScope.namespace, scopeId, true,
  )
  const currentUnits: Array<DurableEffectRecoveryUnitRecord | null> = []
  for (const unit of synchronization.units) {
    currentUnits.push(await getEffectRecord<DurableEffectRecoveryUnitRecord>(
      db, records, 'unit', unit.namespace, unit.unit.id, true,
    ))
  }
  if (
    !isDurableScopeSynchronization(currentScope ?? undefined, nextScope) ||
    synchronization.units.some((unit, index) =>
      !isDurableUnitRegistration(
        nextScope.scope.ref,
        currentUnits[index] ?? undefined,
        unit,
      ),
    )
  ) return null
  const scopeStored = currentScope
    ? await replaceEffectRecord(
        db, records, 'scope', scopeId, scopeId, currentScope.revision,
        nextScope, faults,
      )
    : await insertEffectRecord(
        db, records, 'scope', scopeId, scopeId, nextScope, faults,
      )
  if (!scopeStored) return null
  for (const unit of synchronization.units) {
    if (!(await insertEffectRecord(
      db, records, 'unit', unit.unit.id, unit.unit.boundaryId, unit, faults,
    ))) return null
  }
  return synchronization
}

export async function transitionPostgresEffectUnit(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  { next }: RuntimeEffectUnitTransition,
): Promise<DurableEffectRecoveryUnitRecord | null> {
  const current = await getEffectRecord<DurableEffectRecoveryUnitRecord>(
    db, records, 'unit', next.namespace, next.unit.id, true,
  )
  if (
    !current ||
    !durableTransitionMatches(current, next) ||
    !isDurableUnitTransition(current.unit.status, next.unit.status)
  ) return null
  return await replaceEffectRecord(
    db, records, 'unit', next.unit.id, next.unit.boundaryId,
    current.revision, next, faults,
  ) ? next : null
}
