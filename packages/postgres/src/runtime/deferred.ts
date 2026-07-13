import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
} from '@use-crux/core/runtime'
import { decodeDeferredIntent, decodeDeferredScope, encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'
import { table } from './sql'

/** Create the Postgres persistence port for invocation scopes and intents. */
export function createPostgresDeferredStore(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeDeferredStorePort {
  const scopes = table(schema, 'defer_scopes')
  const intents = table(schema, 'defer_intents')

  return {
    async getScope(scopeId, options) {
      // FOR UPDATE serializes terminal CAS and concurrent staging on one scope
      // when called inside a store transaction. Outside a transaction the lock
      // is released immediately and behaves like a plain read.
      const result = await db.query(
        `SELECT * FROM ${scopes}
          WHERE namespace = $1 AND scope_id = $2
          FOR UPDATE`,
        [options.namespace, scopeId],
      )
      return result.rows[0] ? decodeDeferredScope(result.rows[0]) : null
    },

    async createScope(
      scope: RuntimeDeferredScope,
    ): Promise<RuntimeDeferredScope> {
      recordWrite(faults)
      // Insert-if-absent only. A delayed first-stage writer under READ COMMITTED
      // must never UPSERT over a concurrent winner's lease or terminal state.
      await db.query(
        `INSERT INTO ${scopes}
          (namespace, scope_id, lease_token, lease_expires_at, finalization,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (namespace, scope_id) DO NOTHING`,
        [
          scope.namespace,
          scope.scopeId,
          scope.leaseToken,
          scope.leaseExpiresAt,
          encodeJson(scope.finalization),
          scope.createdAt,
          scope.updatedAt,
        ],
      )
      const result = await db.query(
        `SELECT * FROM ${scopes}
          WHERE namespace = $1 AND scope_id = $2
          FOR UPDATE`,
        [scope.namespace, scope.scopeId],
      )
      if (!result.rows[0]) {
        throw new Error(
          `Deferred scope \`${scope.scopeId}\` was not durable after createScope.`,
        )
      }
      return decodeDeferredScope(result.rows[0])
    },

    async putScope(scope: RuntimeDeferredScope): Promise<void> {
      recordWrite(faults)
      // Update existing rows only. Creation is createScope (insert-if-absent).
      // Lifecycle is monotonic under the transaction row lock from getScope:
      // open may renew or close; terminal rows never reopen or flip terminals.
      // Illegal transitions update zero rows (no-op) so kernel CAS conflicts.
      const nextState = scope.finalization.state
      await db.query(
        `UPDATE ${scopes}
            SET lease_token = $3,
                lease_expires_at = $4,
                finalization = $5::jsonb,
                updated_at = $6
          WHERE namespace = $1
            AND scope_id = $2
            AND (
              finalization->>'state' = 'open'
              OR (
                finalization->>'state' = $7
                AND $7 IN ('finalized', 'abandoned')
              )
            )`,
        [
          scope.namespace,
          scope.scopeId,
          scope.leaseToken,
          scope.leaseExpiresAt,
          encodeJson(scope.finalization),
          scope.updatedAt,
          nextState,
        ],
      )
    },

    async listScopes(options) {
      const values: unknown[] = [options.namespace]
      const filters = ['namespace = $1']
      if (options.state) {
        values.push(options.state)
        filters.push(`finalization->>'state' = $${values.length}`)
      }
      if (options.leaseExpiresBefore) {
        values.push(options.leaseExpiresBefore)
        filters.push(`lease_expires_at < $${values.length}`)
      }
      values.push(options.limit ?? 100)
      const result = await db.query(
        `SELECT * FROM ${scopes}
          WHERE ${filters.join(' AND ')}
          ORDER BY lease_expires_at ASC, scope_id ASC
          LIMIT $${values.length}`,
        values,
      )
      return result.rows.map(decodeDeferredScope)
    },

    async getIntent(intentId, options) {
      const result = await db.query(
        `SELECT * FROM ${intents}
          WHERE namespace = $1 AND intent_id = $2
          FOR UPDATE`,
        [options.namespace, intentId],
      )
      return result.rows[0] ? decodeDeferredIntent(result.rows[0]) : null
    },

    async createIntent(
      intent: RuntimeDeferredIntent,
    ): Promise<RuntimeDeferredIntent> {
      recordWrite(faults)
      // Insert-if-absent only. Concurrent staging must keep the first accepted
      // work_id, target_id, and input — never UPSERT identity columns.
      await db.query(
        `INSERT INTO ${intents}
          (namespace, scope_id, intent_id, work_id, target_id, input, provenance,
           state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
         ON CONFLICT (namespace, intent_id) DO NOTHING`,
        [
          intent.namespace,
          intent.scopeId,
          intent.intentId,
          intent.workId,
          intent.targetId,
          encodeJson(intent.input),
          intent.provenance === undefined
            ? null
            : encodeJson(intent.provenance),
          intent.state,
          intent.createdAt,
          intent.updatedAt,
        ],
      )
      const result = await db.query(
        `SELECT * FROM ${intents}
          WHERE namespace = $1 AND intent_id = $2
          FOR UPDATE`,
        [intent.namespace, intent.intentId],
      )
      if (!result.rows[0]) {
        throw new Error(
          `Deferred intent \`${intent.intentId}\` was not durable after createIntent.`,
        )
      }
      return decodeDeferredIntent(result.rows[0])
    },

    async putIntent(intent: RuntimeDeferredIntent): Promise<void> {
      recordWrite(faults)
      // Update existing lifecycle only. Creation is createIntent. Identity
      // columns are never rewritten, and terminal rows cannot switch state.
      await db.query(
        `UPDATE ${intents}
            SET state = $3,
                updated_at = $4
          WHERE namespace = $1
            AND intent_id = $2
            AND (state = 'staged' OR state = $3)`,
        [intent.namespace, intent.intentId, intent.state, intent.updatedAt],
      )
    },

    async listIntents(options) {
      const values: unknown[] = [options.namespace, options.scopeId]
      const filters = ['namespace = $1', 'scope_id = $2']
      if (options.state) {
        values.push(options.state)
        filters.push(`state = $${values.length}`)
      }
      values.push(options.limit ?? 100)
      const result = await db.query(
        `SELECT * FROM ${intents}
          WHERE ${filters.join(' AND ')}
          ORDER BY created_at ASC, intent_id ASC
          LIMIT $${values.length}`,
        values,
      )
      return result.rows.map(decodeDeferredIntent)
    },
  }
}
