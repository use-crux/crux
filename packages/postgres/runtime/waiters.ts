import type {
  ClaimExpiredWaitersOptions,
  NewRuntimeWaiter,
  ResolveWaiterOptions,
  RuntimeWaiter,
  RuntimeWaiterStorePort,
  TimerId,
  WaiterId,
  WorkId,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeWaiter, encodeJson } from './codec'
import { newRuntimeId } from './ids'
import type { PgExecutor } from './sql'
import { table } from './sql'

export function createPostgresWaiterPort(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeWaiterStorePort {
  const waiters = table(schema, 'waiters')

  return {
    async register(waiter: NewRuntimeWaiter): Promise<RuntimeWaiter> {
      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${waiters}
          (waiter_id, namespace, event_name, match, work_id, work, timeout_at, state)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, 'armed')
         RETURNING *`,
        [
          newRuntimeId('waiter'),
          waiter.namespace,
          waiter.eventName,
          encodeJson(waiter.match),
          waiter.workId,
          encodeJson(waiter.work),
          waiter.timeoutAt,
        ],
      )
      return decodeWaiter(result.rows[0])
    },

    async resolve(
      eventName: string,
      payload,
      options?: ResolveWaiterOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      const values: unknown[] = [eventName]
      const filters = ['event_name = $1', "state = 'armed'"]
      if (options?.namespace) {
        values.push(options.namespace)
        filters.push(`namespace = $${values.length}`)
      }
      const result = await db.query(
        `SELECT * FROM ${waiters} WHERE ${filters.join(' AND ')}`,
        values,
      )
      return result.rows.map(decodeWaiter).filter((waiter) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return Object.keys(waiter.match).length === 0
        }
        const record = payload as Record<string, unknown>
        return Object.entries(waiter.match).every(
          ([key, expected]) => record[key] === expected,
        )
      })
    },

    async cancel(waiterId: WaiterId): Promise<void> {
      recordWrite(faults)
      await db.query(
        `UPDATE ${waiters}
            SET state = 'cancelled'
          WHERE waiter_id = $1
            AND state = 'armed'`,
        [waiterId],
      )
    },

    async attachTimer(waiterId: WaiterId, timerId: TimerId): Promise<void> {
      recordWrite(faults)
      await db.query(
        `UPDATE ${waiters} SET timer_id = $2 WHERE waiter_id = $1`,
        [waiterId, timerId],
      )
    },

    async listByWork(workId: WorkId): Promise<readonly RuntimeWaiter[]> {
      const result = await db.query(
        `SELECT * FROM ${waiters} WHERE work_id = $1 ORDER BY waiter_id ASC`,
        [workId],
      )
      return result.rows.map(decodeWaiter)
    },

    async claimExpired(
      options: ClaimExpiredWaitersOptions,
    ): Promise<readonly RuntimeWaiter[]> {
      const values: unknown[] = [options.now, options.limit ?? 100]
      const filters = [
        "state = 'armed'",
        'timeout_at IS NOT NULL',
        'timeout_at <= $1',
      ]
      if (options.namespace) {
        values.push(options.namespace)
        filters.push(`namespace = $${values.length}`)
      }
      const result = await db.query(
        `SELECT * FROM ${waiters}
          WHERE ${filters.join(' AND ')}
          ORDER BY timeout_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        values,
      )
      return result.rows.map(decodeWaiter)
    },

    async transition(
      waiterId: WaiterId,
      from: RuntimeWaiter['state'],
      to: RuntimeWaiter['state'],
    ): Promise<boolean> {
      recordWrite(faults)
      const result = await db.query(
        `UPDATE ${waiters}
            SET state = $3
          WHERE waiter_id = $1
            AND state = $2`,
        [waiterId, from, to],
      )
      return (result.rowCount ?? 0) > 0
    },
  }
}
