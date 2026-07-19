import type { MutationCtx } from '../_generated/server.js'
import { pruneBatch } from './shared'

const TERMINAL_WORK_STATUSES = ['completed', 'cancelled', 'dead-letter'] as const
const TERMINAL_SNAPSHOT_STATUSES = [
  'completed',
  'blocked',
  'expired',
  'cancelled',
] as const

type RuntimeStateTableName = 'runtimeWork' | 'runtimeSnapshots'
type RuntimeStatus = (typeof TERMINAL_WORK_STATUSES | typeof TERMINAL_SNAPSHOT_STATUSES)[number]

/** Delete eligible terminal work rows for retention maintenance. */
export async function pruneTerminalWorkRows(
  ctx: MutationCtx,
  options: {
    readonly namespace?: string
    readonly before: number
    readonly limit: number
  },
) {
  return await pruneTerminalRows(ctx, {
    tableName: 'runtimeWork',
    statuses: TERMINAL_WORK_STATUSES,
    ...options,
  })
}

/** Delete eligible terminal snapshot rows for retention maintenance. */
export async function pruneTerminalSnapshotRows(
  ctx: MutationCtx,
  options: {
    readonly namespace?: string
    readonly before: number
    readonly limit: number
  },
) {
  return await pruneTerminalRows(ctx, {
    tableName: 'runtimeSnapshots',
    statuses: TERMINAL_SNAPSHOT_STATUSES,
    ...options,
  })
}

/** Delete eligible completed idempotency records for retention maintenance. */
export async function pruneCompletedIdempotencyRows(
  ctx: MutationCtx,
  options: {
    readonly namespace?: string
    readonly before: number
    readonly limit: number
  },
) {
  const namespace = options.namespace
  const rows = namespace
    ? await ctx.db
        .query('runtimeIdempotency')
        .withIndex('by_namespace_completed', (q) => q.eq('namespace', namespace))
        .take(takeLimit(options.limit))
    : await ctx.db
        .query('runtimeIdempotency')
        .withIndex('by_completed')
        .take(takeLimit(options.limit))
  const batch = pruneBatch(
    rows
      .filter((row) => row.completedAt < options.before)
      .sort((left, right) => left.completedAt - right.completedAt),
    options.limit,
  )
  for (const row of batch.selected) await ctx.db.delete(row._id)
  return { removed: batch.selected.length, truncated: batch.truncated }
}

/** Merge a delivered suspend payload into a snapshot's durable delivery map. */
export function mergeDeliveredSuspend(
  current: Record<string, unknown> | undefined,
  pendingSuspends: Array<Record<string, unknown>>,
  waiterId: string,
  eventId: string,
  payload: unknown,
): Record<string, unknown> | undefined {
  const suspend = pendingSuspends.find((pending) => pending.waiterId === waiterId)
  const deliveryKey = typeof suspend?.deliveryKey === 'string'
    ? suspend.deliveryKey
    : typeof suspend?.label === 'string'
      ? suspend.label
      : undefined
  if (!deliveryKey) return current
  return {
    ...(current ?? {}),
    [deliveryKey]: { eventId, payload },
  }
}

/** Read the current idle counter for a runtime idle scope. */
export async function readIdle(
  ctx: MutationCtx,
  namespace: string,
  scope: string,
): Promise<number> {
  const existing = await ctx.db
    .query('runtimeIdleCounters')
    .withIndex('by_namespace_scope', (q) => q.eq('namespace', namespace).eq('scope', scope))
    .first()
  return existing?.count ?? 0
}

/** Apply a delta to an idle counter and return the new count. */
export async function updateIdle(
  ctx: MutationCtx,
  namespace: string,
  scope: string,
  delta: number,
): Promise<number> {
  const existing = await ctx.db
    .query('runtimeIdleCounters')
    .withIndex('by_namespace_scope', (q) => q.eq('namespace', namespace).eq('scope', scope))
    .first()
  const count = (existing?.count ?? 0) + delta
  if (count < 0) throw new Error(`Runtime idle counter ${namespace}:${scope} went negative.`)
  if (existing) await ctx.db.patch(existing._id, { count })
  else await ctx.db.insert('runtimeIdleCounters', { namespace, scope, count })
  return count
}

async function pruneTerminalRows(
  ctx: MutationCtx,
  options: {
    readonly tableName: RuntimeStateTableName
    readonly namespace?: string
    readonly statuses: readonly RuntimeStatus[]
    readonly before: number
    readonly limit: number
  },
) {
  const rows = await rowsByStatuses(ctx, options)
  const batch = pruneBatch(
    rows.filter((row) => row.updatedAt < options.before),
    options.limit,
  )
  for (const row of batch.selected) await ctx.db.delete(row._id)
  return { removed: batch.selected.length, truncated: batch.truncated }
}

async function rowsByStatuses(
  ctx: MutationCtx,
  options: {
    readonly tableName: RuntimeStateTableName
    readonly namespace?: string
    readonly statuses: readonly RuntimeStatus[]
    readonly limit: number
  },
) {
  const namespace = options.namespace
  const rows = (
    await Promise.all(
      options.statuses.map((status) =>
        namespace
          ? ctx.db
              .query(options.tableName)
              .withIndex('by_namespace_status_updated', (q) =>
                q.eq('namespace', namespace).eq('status', status),
              )
              .take(takeLimit(options.limit))
          : ctx.db
              .query(options.tableName)
              .withIndex('by_status_updated', (q) => q.eq('status', status))
              .take(takeLimit(options.limit)),
      ),
    )
  ).flat()
  return rows.sort((left, right) => left.updatedAt - right.updatedAt)
}

function takeLimit(limit: number): number {
  return Math.max(0, Math.floor(limit)) + 1
}
