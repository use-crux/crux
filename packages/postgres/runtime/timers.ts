import type {
  ClaimDueTimersOptions,
  NewRuntimeTimerRecord,
  RuntimeTimerRecord,
  RuntimeTimerState,
  RuntimeTimerStorePort,
  TimerId,
  WorkId,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeTimer, encodeJson } from './codec'
import { newRuntimeId } from './ids'
import type { PgExecutor } from './sql'
import { table } from './sql'

export function createPostgresTimerStore(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeTimerStorePort {
  const timers = table(schema, 'timers')

  return {
    async put(timer: NewRuntimeTimerRecord): Promise<RuntimeTimerRecord> {
      if (timer.idempotencyKey) {
        const existing = await db.query(
          `SELECT * FROM ${timers}
            WHERE namespace = $1 AND idempotency_key = $2`,
          [timer.namespace, timer.idempotencyKey],
        )
        if (existing.rows[0]) return decodeTimer(existing.rows[0])
      }
      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${timers}
          (timer_id, namespace, fire_at, work_id, waiter_id, idle_scope,
           work, idempotency_key, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'scheduled')
         ON CONFLICT (namespace, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
         RETURNING *`,
        [
          newRuntimeId('timer'),
          timer.namespace,
          timer.fireAt,
          timer.workId,
          timer.waiterId,
          timer.idleScope,
          encodeJson(timer.work),
          timer.idempotencyKey,
        ],
      )
      return decodeTimer(result.rows[0])
    },

    async get(timerId: TimerId): Promise<RuntimeTimerRecord | null> {
      const result = await db.query(
        `SELECT * FROM ${timers} WHERE timer_id = $1`,
        [timerId],
      )
      return result.rows[0] ? decodeTimer(result.rows[0]) : null
    },

    async claimDue(
      options: ClaimDueTimersOptions,
    ): Promise<readonly RuntimeTimerRecord[]> {
      const values: unknown[] = [options.now, options.limit ?? 100]
      const filters = ["state = 'scheduled'", 'fire_at <= $1']
      if (options.namespace) {
        values.push(options.namespace)
        filters.push(`namespace = $${values.length}`)
      }
      const result = await db.query(
        `SELECT * FROM ${timers}
          WHERE ${filters.join(' AND ')}
          ORDER BY fire_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        values,
      )
      return result.rows.map(decodeTimer)
    },

    async list(options): Promise<readonly RuntimeTimerRecord[]> {
      const values: unknown[] = [options.namespace]
      const filters = ['namespace = $1']
      if (options.state) {
        values.push(options.state)
        filters.push(`state = $${values.length}`)
      }
      values.push(options.limit ?? 100)
      const result = await db.query(
        `SELECT * FROM ${timers}
          WHERE ${filters.join(' AND ')}
          ORDER BY fire_at ASC
          LIMIT $${values.length}`,
        values,
      )
      return result.rows.map(decodeTimer)
    },

    async listByWork(workId: WorkId): Promise<readonly RuntimeTimerRecord[]> {
      const result = await db.query(
        `SELECT * FROM ${timers} WHERE work_id = $1 ORDER BY timer_id ASC`,
        [workId],
      )
      return result.rows.map(decodeTimer)
    },

    async transition(
      timerId: TimerId,
      from: RuntimeTimerState,
      to: RuntimeTimerState,
    ): Promise<boolean> {
      recordWrite(faults)
      const result = await db.query(
        `UPDATE ${timers}
            SET state = $3
          WHERE timer_id = $1
            AND state = $2`,
        [timerId, from, to],
      )
      return (result.rowCount ?? 0) > 0
    },
  }
}
