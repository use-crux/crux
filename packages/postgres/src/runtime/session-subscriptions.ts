/** PostgreSQL Session Signal subscription persistence. */

import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from '@use-crux/core/runtime/internal/session-store'
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
      readonly now: Date
    }): Promise<SubscriptionRecord> {
      const match = sessionSubscriptionMatchValue(input.match)
      const matchKey = sessionSubscriptionMatchKey(match)
      const matchJson = match === undefined ? null : encodeJson(match)
      const now = input.now.toISOString()
      recordWrite(faults)
      // Conflict-safe on the canonical identity unique index. Concurrent same-key
      // upserts share one row; unsubscribed rows reactivate without allocating.
      const upserted = await db.query<Record<string, unknown>>(
        `INSERT INTO ${subscriptions}
          (namespace, session_id, subscription_id, signal_id, match, match_key,
           state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', $7, $7)
         ON CONFLICT (namespace, session_id, signal_id, match_key) DO UPDATE
           SET state = 'active',
               updated_at = EXCLUDED.updated_at,
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
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${subscriptions}
          WHERE namespace = $1 AND signal_id = $2 AND state = 'active'
          ORDER BY created_at ASC`,
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
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `UPDATE ${subscriptions}
            SET state = 'unsubscribed', updated_at = $4
          WHERE namespace = $1 AND session_id = $2 AND subscription_id = $3
          RETURNING *`,
        [namespace, sessionId, subscriptionId, now.toISOString()],
      )
      if (!result.rows[0]) {
        throw new Error(
          `Session subscription "${subscriptionId}" was not found.`,
        )
      }
      return decodeSubscription(result.rows[0])
    },
  }
}

function decodeSubscription(row: Record<string, unknown>): SubscriptionRecord {
  const matchKey =
    typeof row.match_key === 'string'
      ? row.match_key
      : sessionSubscriptionMatchKey(
          row.match === null || row.match === undefined
            ? undefined
            : (row.match as JsonValue),
        )
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
