/** Convex Session Signal subscription persistence. */

import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from '@use-crux/core/runtime/internal/session-store'
import type { JsonValue } from '@use-crux/core'
import type { RuntimeStoreTransaction } from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import {
  readSession,
  replaceSession,
  sessionRecord,
} from './session_helpers'

type SessionPort = NonNullable<RuntimeStoreTransaction['sessions']>
type SubscriptionInput = Parameters<SessionPort['upsertSubscription']>[0]

/**
 * Create or reactivate one Session subscription.
 *
 * @remarks Serialized through the parent Session document so concurrent same-key
 * upserts share one OCC retry chain. Prefers deterministic `subscriptionId`
 * lookup, then canonical match identity.
 */
export async function upsertSessionSubscription(ctx: MutationCtx, input: SubscriptionInput) {
  const sessionRow = await readSession(ctx, input.namespace, input.sessionId)
  if (!sessionRow) {
    throw new Error(`Session "${input.sessionId}" was not found.`)
  }
  const match = sessionSubscriptionMatchValue(input.match)
  const matchKey = input.matchKey
  const now = input.now.toISOString()

  const byId = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_namespace_subscription', (q) =>
      q.eq('namespace', input.namespace).eq('subscriptionId', input.subscriptionId),
    )
    .unique()
  if (byId && byId.sessionId === input.sessionId) {
    const active =
      byId.state === 'active'
        ? byId
        : await patchSubscription(ctx, byId, now)
    await touchSession(ctx, sessionRow, now)
    return subscriptionRecord(active)
  }

  const byMatch = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_session_signal_match', (q) =>
      q
        .eq('namespace', input.namespace)
        .eq('sessionId', input.sessionId)
        .eq('signalId', input.signalId)
        .eq('matchKey', matchKey),
    )
    .unique()
  if (byMatch) {
    const active =
      byMatch.state === 'active'
        ? byMatch
        : await patchSubscription(ctx, byMatch, now)
    await touchSession(ctx, sessionRow, now)
    return subscriptionRecord(active)
  }

  const created = {
    schemaVersion: 1 as const,
    namespace: input.namespace,
    sessionId: input.sessionId,
    subscriptionId: input.subscriptionId,
    signalId: input.signalId,
    ...(match === undefined ? {} : { match }),
    matchKey,
    state: 'active' as const,
    createdAt: now,
    updatedAt: now,
  }
  await ctx.db.insert('runtimeSessionSubscriptions', created)
  // Parent Session write serializes concurrent subscription mutations via OCC.
  await touchSession(ctx, sessionRow, now)
  return subscriptionRecord(created)
}

export async function getSessionSubscription(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
  subscriptionId: string,
) {
  const row = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_namespace_subscription', (q) =>
      q.eq('namespace', namespace).eq('subscriptionId', subscriptionId),
    )
    .unique()
  return row && row.sessionId === sessionId ? subscriptionRecord(row) : null
}

export async function listSessionSubscriptions(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
) {
  const rows = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_session_state', (q) =>
      q.eq('namespace', namespace).eq('sessionId', sessionId).eq('state', 'active'),
    )
    .collect()
  return rows.map(subscriptionRecord)
}

export async function listActiveSubscriptionsForSignal(
  ctx: MutationCtx,
  namespace: string,
  signalId: string,
) {
  const rows = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_signal_state', (q) =>
      q.eq('namespace', namespace).eq('signalId', signalId).eq('state', 'active'),
    )
    .collect()
  return rows.map(subscriptionRecord)
}

export async function unsubscribeSessionSubscription(
  ctx: MutationCtx,
  namespace: string,
  sessionId: string,
  subscriptionId: string,
  now: Date,
) {
  const sessionRow = await readSession(ctx, namespace, sessionId)
  if (!sessionRow) {
    throw new Error(`Session "${sessionId}" was not found.`)
  }
  const row = await ctx.db
    .query('runtimeSessionSubscriptions')
    .withIndex('by_namespace_subscription', (q) =>
      q.eq('namespace', namespace).eq('subscriptionId', subscriptionId),
    )
    .unique()
  if (!row || row.sessionId !== sessionId) {
    throw new Error(`Session subscription "${subscriptionId}" was not found.`)
  }
  const timestamp = now.toISOString()
  if (row.state === 'unsubscribed') {
    await touchSession(ctx, sessionRow, timestamp)
    return subscriptionRecord(row)
  }
  const updated = await patchSubscription(ctx, row, timestamp, 'unsubscribed')
  await touchSession(ctx, sessionRow, timestamp)
  return subscriptionRecord(updated)
}

async function patchSubscription(
  ctx: MutationCtx,
  row: {
    readonly _id: Parameters<MutationCtx['db']['patch']>[0]
    readonly schemaVersion: 1
    readonly namespace: string
    readonly sessionId: string
    readonly subscriptionId: string
    readonly signalId: string
    readonly match?: unknown
    readonly matchKey?: string
    readonly state: 'active' | 'unsubscribed'
    readonly createdAt: string
    readonly updatedAt: string
  },
  updatedAt: string,
  state: 'active' | 'unsubscribed' = 'active',
) {
  await ctx.db.patch(row._id, { state, updatedAt })
  return { ...row, state, updatedAt }
}

async function touchSession(
  ctx: MutationCtx,
  row: NonNullable<Awaited<ReturnType<typeof readSession>>>,
  updatedAt: string,
) {
  const current = sessionRecord(row)
  await replaceSession(ctx, row, {
    ...current,
    updatedAt,
  })
}

function subscriptionRecord(row: {
  readonly schemaVersion: 1
  readonly namespace: string
  readonly sessionId: string
  readonly subscriptionId: string
  readonly signalId: string
  readonly match?: unknown
  readonly matchKey?: string
  readonly state: 'active' | 'unsubscribed'
  readonly createdAt: string
  readonly updatedAt: string
}) {
  const match =
    row.match === undefined
      ? undefined
      : sessionSubscriptionMatchValue(row.match as JsonValue)
  return {
    schemaVersion: 1 as const,
    namespace: row.namespace,
    sessionId: row.sessionId,
    subscriptionId: row.subscriptionId,
    signalId: row.signalId,
    ...(match === undefined ? {} : { match }),
    matchKey: row.matchKey ?? sessionSubscriptionMatchKey(match),
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
