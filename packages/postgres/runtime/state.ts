import type {
  FlowId,
  FlowSnapshot,
  IdempotencyRecord,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimeStatePort,
  RuntimeStateReadOptions,
  SetWorkPendingOptions,
  WorkId,
  WorkItem,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeFlowSnapshot, decodeWorkItem, encodeJson } from './codec'
import { createPostgresIdleCounterPort } from './idle'
import type { PgExecutor } from './sql'
import { table } from './sql'

const DEFAULT_MAX_ATTEMPTS = 8

type ListWorkOptions = Parameters<RuntimeStatePort['listWork']>[0]

export function createPostgresStatePort(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeStatePort {
  const workTable = table(schema, 'work')
  const snapshotTable = table(schema, 'snapshots')
  const idempotencyTable = table(schema, 'idempotency')
  const idleCounters = createPostgresIdleCounterPort(db, schema, faults)

  return {
    async createWork(input: NewWorkItem): Promise<WorkItem> {
      const now = input.now ?? new Date()
      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${workTable}
          (namespace, work_id, work, target_id, status, attempt, max_attempts,
           not_before, idempotency_key, idle_scope, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, 'pending', 1, $5, $6, $7, $8, $9, $9)
         ON CONFLICT (namespace, work_id) DO NOTHING
         RETURNING *`,
        [
          input.namespace,
          input.workId,
          encodeJson(input.work),
          input.targetId,
          input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          input.notBefore,
          input.idempotencyKey,
          input.idleScope,
          now,
        ],
      )
      if (result.rowCount && input.idleScope) {
        await idleCounters.incrementIdle(input.namespace, input.idleScope)
      }
      if (result.rows[0]) return decodeWorkItem(result.rows[0])
      const existing = await getWork(input.workId, {
        namespace: input.namespace,
      })
      if (!existing) throw new Error(`Failed to read existing runtime work.`)
      return existing
    },

    getWork,

    async putWork(work: WorkItem): Promise<void> {
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${workTable}
          (namespace, work_id, work, target_id, status, attempt, max_attempts,
           not_before, idempotency_key, idle_scope, lease_token, last_error,
           created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         ON CONFLICT (namespace, work_id) DO UPDATE SET
           work = EXCLUDED.work,
           target_id = EXCLUDED.target_id,
           status = EXCLUDED.status,
           attempt = EXCLUDED.attempt,
           max_attempts = EXCLUDED.max_attempts,
           not_before = EXCLUDED.not_before,
           idempotency_key = EXCLUDED.idempotency_key,
           idle_scope = EXCLUDED.idle_scope,
           lease_token = EXCLUDED.lease_token,
           last_error = EXCLUDED.last_error,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          work.namespace,
          work.workId,
          encodeJson(work.work),
          work.targetId,
          work.status,
          work.attempt,
          work.maxAttempts,
          work.notBefore,
          work.idempotencyKey,
          work.idleScope,
          work.leaseToken,
          work.lastError ? encodeJson(work.lastError) : null,
          work.createdAt,
          work.updatedAt,
        ],
      )
    },

    async listWork(options: ListWorkOptions): Promise<readonly WorkItem[]> {
      const values: unknown[] = [options.namespace, options.status]
      const filters = ['namespace = $1', 'status = $2']
      if (options.updatedBefore) {
        values.push(options.updatedBefore)
        filters.push(`updated_at < $${values.length}`)
      }
      values.push(options.limit ?? 100)
      const result = await db.query(
        `SELECT * FROM ${workTable}
          WHERE ${filters.join(' AND ')}
          ORDER BY updated_at ASC
          LIMIT $${values.length}`,
        values,
      )
      return result.rows.map(decodeWorkItem)
    },

    async setWorkPending(
      workId: WorkId,
      options: SetWorkPendingOptions,
    ): Promise<WorkItem | null> {
      recordWrite(faults)
      const result = await db.query(
        `UPDATE ${workTable}
            SET work = $3::jsonb,
                status = 'pending',
                attempt = 1,
                not_before = NULL,
                idempotency_key = $4,
                lease_token = NULL,
                last_error = NULL,
                updated_at = now()
          WHERE namespace = $1
            AND work_id = $2
            AND status = 'suspended'
          RETURNING *`,
        [
          options.namespace,
          workId,
          encodeJson(options.work),
          options.idempotencyKey,
        ],
      )
      return result.rows[0] ? decodeWorkItem(result.rows[0]) : null
    },

    async getSnapshot(
      flowId: FlowId,
      options: RuntimeStateReadOptions,
    ): Promise<FlowSnapshot | null> {
      const result = await db.query(
        `SELECT * FROM ${snapshotTable} WHERE namespace = $1 AND flow_id = $2`,
        [options.namespace, flowId],
      )
      return result.rows[0] ? decodeFlowSnapshot(result.rows[0]) : null
    },

    async putSnapshot(snapshot: FlowSnapshot): Promise<void> {
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${snapshotTable}
          (namespace, flow_id, work_id, target_id, status, input,
           completed_steps, fingerprint, pending_suspends, scheduled_effects, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
         ON CONFLICT (namespace, flow_id) DO UPDATE SET
           work_id = EXCLUDED.work_id,
           target_id = EXCLUDED.target_id,
           status = EXCLUDED.status,
           input = EXCLUDED.input,
           completed_steps = EXCLUDED.completed_steps,
           fingerprint = EXCLUDED.fingerprint,
           pending_suspends = EXCLUDED.pending_suspends,
           scheduled_effects = EXCLUDED.scheduled_effects,
           updated_at = EXCLUDED.updated_at`,
        [
          snapshot.namespace,
          snapshot.flowId,
          snapshot.workId,
          snapshot.targetId,
          snapshot.status,
          encodeJson(snapshot.input),
          encodeJson(snapshot.completedSteps),
          encodeJson(snapshot.fingerprint),
          encodeJson(snapshot.pendingSuspends),
          snapshot.scheduledEffects
            ? encodeJson(snapshot.scheduledEffects)
            : null,
          snapshot.updatedAt,
        ],
      )
    },

    async markSnapshotDelivered(
      workId: WorkId,
      options: MarkSnapshotDeliveredOptions,
    ): Promise<void> {
      const result = await db.query(
        `SELECT * FROM ${snapshotTable} WHERE namespace = $1 AND work_id = $2`,
        [options.namespace, workId],
      )
      const snapshot = result.rows[0]
        ? decodeFlowSnapshot(result.rows[0])
        : null
      if (!snapshot) return
      const pendingSuspends = snapshot.pendingSuspends.map((suspend) =>
        suspend.waiterId === options.waiterId
          ? { ...suspend, delivered: { eventId: options.eventId } }
          : suspend,
      )
      recordWrite(faults)
      await db.query(
        `UPDATE ${snapshotTable}
            SET pending_suspends = $3::jsonb,
                updated_at = now()
          WHERE namespace = $1 AND flow_id = $2`,
        [snapshot.namespace, snapshot.flowId, encodeJson(pendingSuspends)],
      )
    },

    async hasIdempotencyKey(namespace: string, key: string): Promise<boolean> {
      const result = await db.query(
        `SELECT 1 FROM ${idempotencyTable} WHERE namespace = $1 AND key = $2`,
        [namespace, key],
      )
      return Boolean(result.rows[0])
    },

    async putIdempotencyKey(record: IdempotencyRecord): Promise<void> {
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${idempotencyTable} (namespace, key, completed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (namespace, key) DO NOTHING`,
        [record.namespace, record.key, record.completedAt],
      )
    },

    ...idleCounters,
  }

  async function getWork(
    workId: WorkId,
    options: RuntimeStateReadOptions,
  ): Promise<WorkItem | null> {
    const result = await db.query(
      `SELECT * FROM ${workTable} WHERE namespace = $1 AND work_id = $2`,
      [options.namespace, workId],
    )
    return result.rows[0] ? decodeWorkItem(result.rows[0]) : null
  }
}
