import type {
  RuntimeOutboxItem,
  RuntimeOutboxPort,
  WakeEnvelope,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeOutbox, encodeJson } from './codec'
import { newRuntimeId } from './ids'
import type { PgExecutor } from './sql'
import { table } from './sql'

export function createPostgresOutboxPort(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeOutboxPort {
  const outbox = table(schema, 'outbox')

  return {
    async put(envelope: WakeEnvelope): Promise<RuntimeOutboxItem> {
      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${outbox}
          (outbox_id, namespace, envelope, state, attempts, next_attempt_at)
         VALUES ($1, $2, $3::jsonb, 'pending', 0, $4)
         RETURNING *`,
        [newRuntimeId('outbox'), envelope.ns, encodeJson(envelope), new Date()],
      )
      return decodeOutbox(result.rows[0])
    },

    async get(outboxId: string): Promise<RuntimeOutboxItem | null> {
      const result = await db.query(
        `SELECT * FROM ${outbox} WHERE outbox_id = $1`,
        [outboxId],
      )
      return result.rows[0] ? decodeOutbox(result.rows[0]) : null
    },

    async claimPending(options): Promise<readonly RuntimeOutboxItem[]> {
      const values: unknown[] = [options.now, options.limit ?? 100]
      const filters = ["state <> 'confirmed'", 'next_attempt_at <= $1']
      if (options.namespace) {
        values.push(options.namespace)
        filters.push(`namespace = $${values.length}`)
      }
      recordWrite(faults)
      const result = await db.query(
        `WITH claim AS (
           SELECT outbox_id
             FROM ${outbox}
            WHERE ${filters.join(' AND ')}
            ORDER BY next_attempt_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
         )
         UPDATE ${outbox}
            SET state = 'dispatched',
                attempts = attempts + 1
          WHERE outbox_id IN (SELECT outbox_id FROM claim)
          RETURNING *`,
        values,
      )
      return result.rows.map(decodeOutbox)
    },

    async confirm(outboxId: string): Promise<void> {
      if (faults.crashBeforeConfirm) {
        faults.crashBeforeConfirm = false
        throw new Error('Injected outbox confirm crash')
      }
      recordWrite(faults)
      await db.query(
        `UPDATE ${outbox} SET state = 'confirmed' WHERE outbox_id = $1`,
        [outboxId],
      )
    },

    async retryLater(outboxId: string, nextAttemptAt: Date): Promise<void> {
      recordWrite(faults)
      await db.query(
        `UPDATE ${outbox}
            SET state = 'pending',
                next_attempt_at = $2
          WHERE outbox_id = $1
            AND state <> 'confirmed'`,
        [outboxId, nextAttemptAt],
      )
    },
  }
}
