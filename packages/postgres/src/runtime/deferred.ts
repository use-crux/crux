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
      const result = await db.query(
        `SELECT * FROM ${scopes} WHERE namespace = $1 AND scope_id = $2`,
        [options.namespace, scopeId],
      )
      return result.rows[0] ? decodeDeferredScope(result.rows[0]) : null
    },

    async putScope(scope: RuntimeDeferredScope): Promise<void> {
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${scopes}
          (namespace, scope_id, lease_token, lease_expires_at, finalization,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (namespace, scope_id) DO UPDATE SET
           lease_token = EXCLUDED.lease_token,
           lease_expires_at = EXCLUDED.lease_expires_at,
           finalization = EXCLUDED.finalization,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
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
        `SELECT * FROM ${intents} WHERE namespace = $1 AND intent_id = $2`,
        [options.namespace, intentId],
      )
      return result.rows[0] ? decodeDeferredIntent(result.rows[0]) : null
    },

    async putIntent(intent: RuntimeDeferredIntent): Promise<void> {
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${intents}
          (namespace, scope_id, intent_id, work_id, target_id, input, state,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
         ON CONFLICT (namespace, intent_id) DO UPDATE SET
           scope_id = EXCLUDED.scope_id,
           work_id = EXCLUDED.work_id,
           target_id = EXCLUDED.target_id,
           input = EXCLUDED.input,
           state = EXCLUDED.state,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          intent.namespace,
          intent.scopeId,
          intent.intentId,
          intent.workId,
          intent.targetId,
          encodeJson(intent.input),
          intent.state,
          intent.createdAt,
          intent.updatedAt,
        ],
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
