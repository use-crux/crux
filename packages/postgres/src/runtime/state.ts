import type {
  FlowId,
  FlowSnapshot,
  IdempotencyRecord,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimeStatePort,
  RuntimeStateReadOptions,
  SetWorkPendingOptions,
  WorkStatusCount,
  WorkId,
  RuntimeWorkItem,
} from '@use-crux/core/runtime'
import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeFlowSnapshot, decodeWorkItem, encodeJson } from './codec'
import { createPostgresIdleCounterPort } from './idle'
import { pruneNamespaceFilters, prunePostgresRows } from './prune'
import type { PgExecutor } from './sql'
import { table } from './sql'

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
    async createWork(input: NewWorkItem): Promise<RuntimeWorkItem> {
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
          input.maxAttempts ?? DEFAULT_RUNTIME_MAX_ATTEMPTS,
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

    async putWork(work: RuntimeWorkItem): Promise<void> {
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

    async listWork(options: ListWorkOptions): Promise<readonly RuntimeWorkItem[]> {
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

    async pruneTerminalWork(options) {
      const { filters, values } = pruneNamespaceFilters(options)
      filters.push(`updated_at < $1`)
      filters.push(`status = ANY($${values.length + 1}::text[])`)
      recordWrite(faults)
      return await prunePostgresRows(db, {
        table: workTable,
        filters,
        values: [...values, ['completed', 'cancelled', 'dead-letter']],
        orderBy: 'updated_at ASC, work_id ASC',
        limit: options.limit,
      })
    },

    async countWork(options): Promise<readonly WorkStatusCount[]> {
      const result = await db.query(
        `SELECT namespace, status, target_id, COUNT(*)::int AS count
           FROM ${workTable}
          WHERE namespace = $1
          GROUP BY namespace, status, target_id
          ORDER BY namespace ASC, status ASC, target_id ASC`,
        [options.namespace],
      )
      return result.rows.map((row) => ({
        namespace: String(row.namespace),
        status: row.status,
        targetId: row.target_id,
        count: Number(row.count),
      }))
    },

    async setWorkPending(
      workId: WorkId,
      options: SetWorkPendingOptions,
    ): Promise<RuntimeWorkItem | null> {
      const from = allowedStatuses(options.from)
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
                updated_at = $5
          WHERE namespace = $1
            AND work_id = $2
            AND status = ANY($6::text[])
          RETURNING *`,
        [
          options.namespace,
          workId,
          encodeJson(options.work),
          options.idempotencyKey,
          options.now ?? new Date(),
          from,
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
          (namespace, flow_id, work_id, target_id, status, effects, input,
           continuation, completed_steps, fingerprint, pending_suspends,
           delivered_suspends, scheduled_work, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
                 $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14)
         ON CONFLICT (namespace, flow_id) DO UPDATE SET
           work_id = EXCLUDED.work_id,
           target_id = EXCLUDED.target_id,
           status = EXCLUDED.status,
           effects = EXCLUDED.effects,
           input = EXCLUDED.input,
           continuation = EXCLUDED.continuation,
           completed_steps = EXCLUDED.completed_steps,
           fingerprint = EXCLUDED.fingerprint,
           pending_suspends = EXCLUDED.pending_suspends,
           delivered_suspends = EXCLUDED.delivered_suspends,
           scheduled_work = EXCLUDED.scheduled_work,
           updated_at = EXCLUDED.updated_at`,
        [
          snapshot.namespace,
          snapshot.flowId,
          snapshot.workId,
          snapshot.targetId,
          snapshot.status,
          snapshot.effects ? encodeJson(snapshot.effects) : null,
          encodeJson(snapshot.input),
          snapshot.continuation !== undefined
            ? encodeJson(snapshot.continuation)
            : null,
          encodeJson(snapshot.completedSteps),
          encodeJson(snapshot.fingerprint),
          encodeJson(snapshot.pendingSuspends),
          snapshot.deliveredSuspends
            ? encodeJson(snapshot.deliveredSuspends)
            : null,
          snapshot.scheduledWork
            ? encodeJson(snapshot.scheduledWork)
            : null,
          snapshot.updatedAt,
        ],
      )
    },

    async pruneTerminalSnapshots(options) {
      const { filters, values } = pruneNamespaceFilters(options)
      filters.push(`updated_at < $1`)
      filters.push(`status = ANY($${values.length + 1}::text[])`)
      recordWrite(faults)
      return await prunePostgresRows(db, {
        table: snapshotTable,
        filters,
        values: [
          ...values,
          ['completed', 'blocked', 'expired', 'cancelled'],
        ],
        orderBy: 'updated_at ASC, flow_id ASC',
        limit: options.limit,
      })
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
          ? { ...suspend, delivered: deliveredSuspend(options) }
          : suspend,
      )
      const deliveredSuspends = mergeDeliveredSuspend(snapshot, options)
      recordWrite(faults)
      await db.query(
        `UPDATE ${snapshotTable}
            SET pending_suspends = $3::jsonb,
                delivered_suspends = $4::jsonb,
                updated_at = now()
          WHERE namespace = $1 AND flow_id = $2`,
        [
          snapshot.namespace,
          snapshot.flowId,
          encodeJson(pendingSuspends),
          deliveredSuspends ? encodeJson(deliveredSuspends) : null,
        ],
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

    async pruneIdempotencyKeys(options) {
      const { filters, values } = pruneNamespaceFilters(options)
      filters.push(`completed_at < $1`)
      recordWrite(faults)
      return await prunePostgresRows(db, {
        table: idempotencyTable,
        filters,
        values,
        orderBy: 'completed_at ASC, key ASC',
        limit: options.limit,
      })
    },

    ...idleCounters,
  }

  async function getWork(
    workId: WorkId,
    options: RuntimeStateReadOptions,
  ): Promise<RuntimeWorkItem | null> {
    const result = await db.query(
      `SELECT * FROM ${workTable} WHERE namespace = $1 AND work_id = $2`,
      [options.namespace, workId],
    )
    return result.rows[0] ? decodeWorkItem(result.rows[0]) : null
  }
}

function mergeDeliveredSuspend(
  snapshot: FlowSnapshot,
  options: MarkSnapshotDeliveredOptions,
): FlowSnapshot['deliveredSuspends'] {
  const suspend = snapshot.pendingSuspends.find((pending) => pending.waiterId === options.waiterId)
  const deliveryKey = suspend?.deliveryKey ?? suspend?.label
  if (!deliveryKey) return snapshot.deliveredSuspends
  return {
    ...(snapshot.deliveredSuspends ?? {}),
    [deliveryKey]: deliveredSuspend(options),
  }
}

function deliveredSuspend(
  options: MarkSnapshotDeliveredOptions,
): NonNullable<FlowSnapshot['pendingSuspends'][number]['delivered']> {
  return { eventId: options.eventId, payload: options.payload }
}

function allowedStatuses(
  from: SetWorkPendingOptions['from'],
): readonly RuntimeWorkItem['status'][] {
  if (from === undefined) return ['suspended']
  return typeof from === 'string' ? [from] : from
}
