import type {
  DurableEffectReceiptRecord,
  DurableEffectEnvelopeRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryClaim,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
  RuntimeEffectRecoveryClaimOptions,
  RuntimeEffectRecoveryRelease,
} from '@use-crux/core/runtime'
import { reconstructDurableEffectScope } from '@use-crux/core/runtime/internal/effects-store'
import { decodeEffectRecord, type PostgresEffectRecord } from './codec'
import type { PostgresStoreFaults } from './faults'
import {
  getEffectRecord,
  listEffectRecords,
  replaceEffectRecord,
  type EffectRecordKind,
} from './effect-records'
import type { PgExecutor } from './sql'

export async function claimPostgresEffectRecovery(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  options: RuntimeEffectRecoveryClaimOptions,
): Promise<readonly DurableEffectRecoveryClaim[]> {
  const claims: DurableEffectRecoveryClaim[] = []
  let cursor = ''
  while (claims.length < options.limit) {
    const result = await db.query(
      `SELECT record_id, record FROM ${records}
        WHERE namespace = $1 AND kind = 'scope' AND record_id > $3
          AND record->'scope'->>'status' = 'rolling_back'
          AND COALESCE((record->>'recoveryLeaseExpiresAt')::bigint, 0) <= $2
        ORDER BY record_id ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED`,
      [
        options.namespace,
        options.now.getTime(),
        cursor,
        Math.max(options.limit, 16),
      ],
    )
    if (result.rows.length === 0) break
    for (const row of result.rows) {
      cursor = String(row.record_id)
      const current = decodeEffectRecord<DurableEffectScopeRecord>(row)
      const set = await lockedScopeRecords(
        db,
        records,
        options.namespace,
        current.scope.ref.id,
      )
      const snapshot = reconstructDurableEffectScope(current.scope.ref, set)
      if (!hasPendingRecovery(snapshot)) continue
      const expiresAt = options.now.getTime() + options.leaseMs
      const scope = {
        ...current,
        fenceToken: options.leaseToken,
        recoveryLeaseExpiresAt: expiresAt,
        ...(options.ownerId ? { recoveryOwnerId: options.ownerId } : {}),
        revision: current.revision + 1,
      }
      if (!(await replaceEffectRecord(
        db, records, 'scope', current.scope.ref.id, current.scope.ref.id,
        current.revision, scope, faults,
      ))) continue
      await fenceRecords(db, records, faults, set, options.leaseToken)
      await fenceNestedRecoveryScopes(
        db,
        records,
        faults,
        snapshot,
        expiresAt,
        options.leaseToken,
        options.ownerId,
      )
      const fenced = await lockedScopeRecords(
        db,
        records,
        options.namespace,
        current.scope.ref.id,
      )
      claims.push(Object.freeze({
        scope: current.scope.ref,
        leaseToken: options.leaseToken,
        expiresAt,
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        snapshot: reconstructDurableEffectScope(current.scope.ref, fenced),
      }))
      if (claims.length >= options.limit) break
    }
  }
  return Object.freeze(claims)
}

async function fenceNestedRecoveryScopes(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  snapshot: DurableEffectScopeSnapshot,
  expiresAt: number,
  fenceToken: string,
  ownerId: string | undefined,
): Promise<void> {
  for (const step of snapshot.plan) {
    if (step.kind !== 'boundary') continue
    const set = await lockedScopeRecords(
      db,
      records,
      snapshot.scopeRecord.namespace,
      step.scope.id,
    )
    if (set.scope.scope.ref.runId !== step.scope.runId) continue
    const scope = {
      ...set.scope,
      fenceToken,
      recoveryLeaseExpiresAt: expiresAt,
      ...(ownerId ? { recoveryOwnerId: ownerId } : {}),
      revision: set.scope.revision + 1,
    }
    if (!(await replaceEffectRecord(
      db,
      records,
      'scope',
      step.scope.id,
      step.scope.id,
      set.scope.revision,
      scope,
      faults,
    ))) throw new TypeError(`Durable Effect scope \`${step.scope.id}\` rejected its fence.`)
    await fenceRecords(db, records, faults, set, fenceToken)
    await fenceNestedRecoveryScopes(
      db,
      records,
      faults,
      reconstructDurableEffectScope(step.scope, { ...set, scope }),
      expiresAt,
      fenceToken,
      ownerId,
    )
  }
}

export async function releasePostgresEffectRecovery(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  release: RuntimeEffectRecoveryRelease,
): Promise<boolean> {
  const current = await getEffectRecord<DurableEffectScopeRecord>(
    db, records, 'scope', release.namespace, release.scope.id, true,
  )
  if (
    !current ||
    current.scope.ref.runId !== release.scope.runId ||
    current.fenceToken !== release.leaseToken
  ) return false
  return await replaceEffectRecord(
    db, records, 'scope', release.scope.id, release.scope.id,
    current.revision, {
      ...current,
      recoveryLeaseExpiresAt: release.now.getTime(),
      revision: current.revision + 1,
    }, faults,
  )
}

async function lockedScopeRecords(
  db: PgExecutor,
  records: string,
  namespace: string,
  scopeId: string,
) {
  const rows = await db.query(
    `SELECT kind, record FROM ${records}
      WHERE namespace = $1 AND boundary_id = $2
      ORDER BY kind, record_id
      FOR UPDATE`,
    [namespace, scopeId],
  )
  const decoded = rows.rows.map((row) => ({
    kind: String(row.kind) as EffectRecordKind,
    record: decodeEffectRecord(row),
  }))
  const byKind = <T extends PostgresEffectRecord>(kind: EffectRecordKind) =>
    decoded.filter((entry) => entry.kind === kind)
      .map((entry) => entry.record as T)
  const scope = byKind<DurableEffectScopeRecord>('scope')[0]
  if (!scope) throw new TypeError(`Durable Effect scope \`${scopeId}\` is unavailable.`)
  return {
    scope,
    receipts: byKind<DurableEffectReceiptRecord>('receipt'),
    units: byKind<DurableEffectRecoveryUnitRecord>('unit'),
    envelopes: byKind<DurableEffectEnvelopeRecord>('envelope'),
    attempts: byKind<DurableEffectRecoveryAttemptRecord>('attempt'),
    reconciliations: byKind<DurableEffectReconciliationRecord>('reconciliation'),
  }
}

async function fenceRecords(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  set: Awaited<ReturnType<typeof lockedScopeRecords>>,
  fenceToken: string,
): Promise<void> {
  const rows: readonly (readonly [EffectRecordKind, string, PostgresEffectRecord])[] = [
    ...set.receipts.map((record) => ['receipt', record.receipt.id, record] as const),
    ...set.units.map((record) => ['unit', record.unit.id, record] as const),
    ...set.attempts.map((record) => ['attempt', record.attemptReceiptId, record] as const),
  ]
  for (const [kind, id, record] of rows) {
    const next = { ...record, fenceToken, revision: record.revision + 1 }
    if (!(await replaceEffectRecord(
      db, records, kind, id, set.scope.scope.ref.id,
      record.revision, next, faults,
    ))) throw new TypeError(`Durable Effect ${kind} \`${id}\` rejected its fence.`)
  }
}

function hasPendingRecovery(
  snapshot: ReturnType<typeof reconstructDurableEffectScope>,
): boolean {
  return snapshot.plan.some(
    (step) => step.status === 'active' || step.status === 'failed',
  )
}
