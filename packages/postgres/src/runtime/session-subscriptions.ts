/** PostgreSQL Session Signal subscription persistence. */

import { sessionSubscriptionMatchValue } from '@use-crux/core/runtime/internal/session-store'
import type { JsonValue } from '@use-crux/core'
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'
import { table } from './sql'

type SubscriptionRecord = {
  readonly schemaVersion: 1
  readonly namespace: string
  readonly sessionId: string
  readonly subscriptionId: string
  readonly signalId: string
  readonly match?: JsonValue
  readonly matchKey: string
  readonly state: 'active' | 'unsubscribed'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Create the Session subscription methods for one PostgreSQL transaction. */
export function createPostgresSessionSubscriptionMethods(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
) {
  const subscriptions = table(schema, 'session_subscriptions')

  return {
    async upsertSubscription(input: {
      readonly namespace: string
      readonly sessionId: string
      readonly subscriptionId: string
      readonly signalId: string
      readonly match?: JsonValue
      readonly matchKey: string
      readonly now: Date
    }): Promise<SubscriptionRecord> {
      const session = await db.query<Record<string, unknown>>(
        `SELECT state FROM ${table(schema, 'sessions')}
          WHERE namespace = $1 AND session_id = $2`,
        [input.namespace, input.sessionId],
      )
      if (!session.rows[0]) {
        throw new Error(`Session "${input.sessionId}" was not found.`)
      }
      if (session.rows[0].state !== 'ready') {
        throw new Error(
          `Session "${input.sessionId}" no longer accepts Signal subscriptions.`,
        )
      }
      const match = sessionSubscriptionMatchValue(input.match)
      const matchKey = input.matchKey
      const matchJson = match === undefined ? null : encodeJson(match)
      const now = input.now.toISOString()
      recordWrite(faults)
      // Conflict-safe on the canonical identity unique index. Concurrent same-key
      // upserts share one row. Active re-upserts are no-ops that preserve
      // updated_at; unsubscribed rows reactivate with a fresh timestamp.
      const upserted = await db.query<Record<string, unknown>>(
        `INSERT INTO ${subscriptions}
          (namespace, session_id, subscription_id, signal_id, match, match_key,
           state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', $7, $7)
         ON CONFLICT (namespace, session_id, signal_id, match_key) DO UPDATE
           SET state = 'active',
               updated_at = CASE
                 WHEN ${subscriptions}.state = 'active'
                   THEN ${subscriptions}.updated_at
                 ELSE EXCLUDED.updated_at
               END,
               match = EXCLUDED.match,
               subscription_id = ${subscriptions}.subscription_id
         RETURNING *`,
        [
          input.namespace,
          input.sessionId,
          input.subscriptionId,
          input.signalId,
          matchJson,
          matchKey,
          now,
        ],
      )
      return decodeSubscription(upserted.rows[0]!)
    },

    async getSubscription(
      namespace: string,
      sessionId: string,
      subscriptionId: string,
    ): Promise<SubscriptionRecord | null> {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${subscriptions}
          WHERE namespace = $1 AND session_id = $2 AND subscription_id = $3`,
        [namespace, sessionId, subscriptionId],
      )
      return result.rows[0] ? decodeSubscription(result.rows[0]) : null
    },

    async listSubscriptions(
      namespace: string,
      sessionId: string,
    ): Promise<readonly SubscriptionRecord[]> {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${subscriptions}
          WHERE namespace = $1 AND session_id = $2 AND state = 'active'
          ORDER BY created_at ASC`,
        [namespace, sessionId],
      )
      return Object.freeze(result.rows.map(decodeSubscription))
    },

    async listActiveSubscriptionsForSignal(
      namespace: string,
      signalId: string,
    ): Promise<readonly SubscriptionRecord[]> {
      // Defense in depth: only ready Sessions receive Signal fan-out.
      const result = await db.query<Record<string, unknown>>(
        `SELECT sub.*
           FROM ${subscriptions} sub
           INNER JOIN ${table(schema, 'sessions')} sess
             ON sess.namespace = sub.namespace
            AND sess.session_id = sub.session_id
          WHERE sub.namespace = $1
            AND sub.signal_id = $2
            AND sub.state = 'active'
            AND sess.state = 'ready'
          ORDER BY sub.created_at ASC`,
        [namespace, signalId],
      )
      return Object.freeze(result.rows.map(decodeSubscription))
    },

    async unsubscribe(
      namespace: string,
      sessionId: string,
      subscriptionId: string,
      now: Date,
    ): Promise<SubscriptionRecord> {
      // Already-unsubscribed rows are no-op retries that preserve updated_at.
      const existing = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${subscriptions}
          WHERE namespace = $1 AND session_id = $2 AND subscription_id = $3`,
        [namespace, sessionId, subscriptionId],
      )
      const current = existing.rows[0]
      if (!current) {
        throw new Error(
          `Session subscription "${subscriptionId}" was not found.`,
        )
      }
      if (current.state === 'unsubscribed') {
        return decodeSubscription(current)
      }
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `UPDATE ${subscriptions}
            SET state = 'unsubscribed', updated_at = $4
          WHERE namespace = $1 AND session_id = $2 AND subscription_id = $3
            AND state = 'active'
          RETURNING *`,
        [namespace, sessionId, subscriptionId, now.toISOString()],
      )
      if (!result.rows[0]) {
        // Concurrent unsubscribe: re-read the stable unsubscribed row.
        const again = await db.query<Record<string, unknown>>(
          `SELECT * FROM ${subscriptions}
            WHERE namespace = $1 AND session_id = $2 AND subscription_id = $3`,
          [namespace, sessionId, subscriptionId],
        )
        if (!again.rows[0]) {
          throw new Error(
            `Session subscription "${subscriptionId}" was not found.`,
          )
        }
        return decodeSubscription(again.rows[0])
      }
      return decodeSubscription(result.rows[0])
    },
  }
}

function decodeSubscription(row: Record<string, unknown>): SubscriptionRecord {
  const matchKey =
    typeof row.match_key === 'string'
      ? row.match_key
      : ''
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: String(row.namespace),
    sessionId: String(row.session_id),
    subscriptionId: String(row.subscription_id),
    signalId: String(row.signal_id),
    ...(row.match === null || row.match === undefined
      ? {}
      : { match: row.match as JsonValue }),
    matchKey,
    state: row.state as 'active' | 'unsubscribed',
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at),
  })
}
