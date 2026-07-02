import type { RuntimeStatePort } from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'
import { table } from './sql'

export type PostgresIdleCounterPort = Pick<
  RuntimeStatePort,
  'incrementIdle' | 'decrementIdle' | 'getIdleCount'
>

export function createPostgresIdleCounterPort(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): PostgresIdleCounterPort {
  const idleTable = table(schema, 'idle_counters')

  return {
    async incrementIdle(namespace: string, scope: string): Promise<number> {
      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${idleTable} AS counters (namespace, scope, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (namespace, scope) DO UPDATE
         SET count = counters.count + 1
       RETURNING count`,
        [namespace, scope],
      )
      return Number(result.rows[0]?.count ?? 0)
    },

    async decrementIdle(namespace: string, scope: string): Promise<number> {
      recordWrite(faults)
      const result = await db.query(
        `UPDATE ${idleTable}
          SET count = count - 1
        WHERE namespace = $1
          AND scope = $2
          AND count > 0
        RETURNING count`,
        [namespace, scope],
      )
      if (!result.rows[0]) {
        throw new Error(`Runtime idle counter ${scope} went negative.`)
      }
      const next = Number(result.rows[0].count)
      if (next === 0) {
        await db.query(
          `DELETE FROM ${idleTable} WHERE namespace = $1 AND scope = $2`,
          [namespace, scope],
        )
      }
      return next
    },

    async getIdleCount(namespace: string, scope: string): Promise<number> {
      const result = await db.query(
        `SELECT count FROM ${idleTable} WHERE namespace = $1 AND scope = $2`,
        [namespace, scope],
      )
      return Number(result.rows[0]?.count ?? 0)
    },
  }
}
