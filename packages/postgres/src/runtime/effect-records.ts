import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
} from '@use-crux/core/runtime'
import { decodeEffectRecord, encodeJson, type PostgresEffectRecord } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'

export type EffectRecordKind =
  | 'attempt'
  | 'envelope'
  | 'receipt'
  | 'reconciliation'
  | 'scope'
  | 'unit'

export interface EffectRecordSet {
  readonly scope: DurableEffectScopeRecord
  readonly receipts: readonly DurableEffectReceiptRecord[]
  readonly units: readonly DurableEffectRecoveryUnitRecord[]
  readonly envelopes: readonly DurableEffectEnvelopeRecord[]
  readonly attempts: readonly DurableEffectRecoveryAttemptRecord[]
  readonly reconciliations: readonly DurableEffectReconciliationRecord[]
}

export async function getEffectRecord<T extends PostgresEffectRecord>(
  db: PgExecutor,
  records: string,
  kind: EffectRecordKind,
  namespace: string,
  recordId: string,
  lock = false,
): Promise<T | null> {
  const result = await db.query(
    `SELECT record FROM ${records}
      WHERE namespace = $1 AND kind = $2 AND record_id = $3
      ${lock ? 'FOR UPDATE' : ''}`,
    [namespace, kind, recordId],
  )
  return result.rows[0] ? decodeEffectRecord<T>(result.rows[0]) : null
}

export async function listEffectRecords<T extends PostgresEffectRecord>(
  db: PgExecutor,
  records: string,
  kind: EffectRecordKind,
  namespace: string,
  boundaryId: string,
): Promise<readonly T[]> {
  const result = await db.query(
    `SELECT record FROM ${records}
      WHERE namespace = $1 AND kind = $2 AND boundary_id = $3
      ORDER BY record_id ASC`,
    [namespace, kind, boundaryId],
  )
  return result.rows.map((row) => decodeEffectRecord<T>(row))
}

export async function insertEffectRecord(
  db: PgExecutor,
  records: string,
  kind: EffectRecordKind,
  recordId: string,
  boundaryId: string,
  value: PostgresEffectRecord,
  faults: PostgresStoreFaults,
): Promise<boolean> {
  recordWrite(faults)
  const result = await db.query(
    `INSERT INTO ${records}
      (namespace, kind, record_id, boundary_id, record, revision, fence_token)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (namespace, kind, record_id) DO NOTHING`,
    [
      value.namespace,
      kind,
      recordId,
      boundaryId,
      encodeJson(value),
      value.revision,
      'fenceToken' in value ? value.fenceToken ?? null : null,
    ],
  )
  return result.rowCount === 1
}

export async function replaceEffectRecord(
  db: PgExecutor,
  records: string,
  kind: EffectRecordKind,
  recordId: string,
  boundaryId: string,
  currentRevision: number,
  value: PostgresEffectRecord,
  faults: PostgresStoreFaults,
): Promise<boolean> {
  recordWrite(faults)
  const result = await db.query(
    `UPDATE ${records}
        SET boundary_id = $4,
            record = $5::jsonb,
            revision = $6,
            fence_token = $7
      WHERE namespace = $1 AND kind = $2 AND record_id = $3
        AND revision = $8`,
    [
      value.namespace,
      kind,
      recordId,
      boundaryId,
      encodeJson(value),
      value.revision,
      'fenceToken' in value ? value.fenceToken ?? null : null,
      currentRevision,
    ],
  )
  return result.rowCount === 1
}
