import type {
  FlowSnapshot,
  IdempotencyRecord,
  NewWorkItem,
  RuntimeStatePort,
  SetWorkPendingOptions,
  WorkId,
  WorkItem,
} from '@use-crux/core/runtime'
import type { WithoutSystemFields } from 'convex/server'
import type { Doc } from '../_generated/dataModel.js'
import type { MutationCtx } from '../_generated/server.js'
import {
  decodeSnapshot,
  decodeWork,
  encodeIdempotency,
  encodeSnapshot,
  encodeWork,
  encodeWorkForCreate,
} from '../../../runtime-engine/codec'
import {
  mergeDeliveredSuspend,
  readIdle,
  updateIdle,
} from './state-helpers'
import { clean, statusAllowed, unsupported } from './composite-utils'

type RuntimeWorkRow = WithoutSystemFields<Doc<'runtimeWork'>>
type RuntimeSnapshotRow = WithoutSystemFields<Doc<'runtimeSnapshots'>>
type RuntimeIdempotencyRow = WithoutSystemFields<Doc<'runtimeIdempotency'>>

export function createCompositeStatePort(ctx: MutationCtx): RuntimeStatePort {
  return {
    createWork: (work) => createWorkRecord(ctx, work),
    getWork: (workId, read) => getWorkRecord(ctx, workId, read.namespace),
    putWork: (work) => putWorkRecord(ctx, work),
    listWork: unsupported('state.listWork'),
    pruneTerminalWork: unsupported('state.pruneTerminalWork'),
    countWork: unsupported('state.countWork'),
    setWorkPending: (workId, pending) =>
      setWorkPendingRecord(ctx, workId, pending),
    getSnapshot: (flowId, read) =>
      getSnapshotRecord(ctx, read.namespace, flowId),
    putSnapshot: (snapshot) => putSnapshotRecord(ctx, snapshot),
    pruneTerminalSnapshots: unsupported('state.pruneTerminalSnapshots'),
    markSnapshotDelivered: (workId, delivery) =>
      markSnapshotDeliveredRecord(ctx, workId, delivery),
    hasIdempotencyKey: async (namespace, key) =>
      Boolean(await getIdempotencyRecord(ctx, namespace, key)),
    putIdempotencyKey: (record) => putIdempotencyRecord(ctx, record),
    pruneIdempotencyKeys: unsupported('state.pruneIdempotencyKeys'),
    incrementIdle: (namespace, scope) => updateIdle(ctx, namespace, scope, 1),
    decrementIdle: (namespace, scope) => updateIdle(ctx, namespace, scope, -1),
    getIdleCount: (namespace, scope) => readIdle(ctx, namespace, scope),
  }
}

async function createWorkRecord(
  ctx: MutationCtx,
  input: NewWorkItem,
): Promise<WorkItem> {
  const existing = await ctx.db
    .query('runtimeWork')
    .withIndex('by_work_id', (q) => q.eq('workId', input.workId))
    .first()
  if (existing) return decodeWork(existing)

  const work = encodeWorkForCreate(input) as RuntimeWorkRow
  await ctx.db.insert('runtimeWork', work)
  if (typeof input.idleScope === 'string') {
    await updateIdle(ctx, input.namespace, input.idleScope, 1)
  }
  return decodeWork(work)
}

async function getWorkRecord(
  ctx: MutationCtx,
  workId: WorkId,
  namespace: string,
): Promise<WorkItem | null> {
  const work = await ctx.db
    .query('runtimeWork')
    .withIndex('by_work_id', (q) => q.eq('workId', workId))
    .first()
  return work?.namespace === namespace ? decodeWork(work) : null
}

async function putWorkRecord(
  ctx: MutationCtx,
  work: WorkItem,
): Promise<void> {
  const existing = await ctx.db
    .query('runtimeWork')
    .withIndex('by_work_id', (q) => q.eq('workId', work.workId))
    .first()
  const encoded = encodeWork(work) as RuntimeWorkRow
  if (existing) await ctx.db.replace(existing._id, encoded)
  else await ctx.db.insert('runtimeWork', encoded)
}

async function setWorkPendingRecord(
  ctx: MutationCtx,
  workId: WorkId,
  pending: SetWorkPendingOptions,
): Promise<WorkItem | null> {
  const existing = await ctx.db
    .query('runtimeWork')
    .withIndex('by_work_id', (q) => q.eq('workId', workId))
    .first()
  if (
    !existing ||
    existing.namespace !== pending.namespace ||
    !statusAllowed(String(existing.status), pending.from)
  ) {
    return null
  }

  const next = clean({
    ...existing,
    work: pending.work,
    status: 'pending',
    attempt: 1,
    idempotencyKey: pending.idempotencyKey,
    updatedAt: Date.now(),
    notBefore: undefined,
    leaseToken: undefined,
    lastError: undefined,
  })
  await ctx.db.replace(existing._id, next)
  return decodeWork(next as unknown)
}

async function getSnapshotRecord(
  ctx: MutationCtx,
  namespace: string,
  flowId: string,
): Promise<FlowSnapshot | null> {
  const snapshot = await ctx.db
    .query('runtimeSnapshots')
    .withIndex('by_flow', (q) => q.eq('namespace', namespace).eq('flowId', flowId))
    .first()
  return snapshot ? decodeSnapshot<FlowSnapshot>(snapshot) : null
}

async function putSnapshotRecord(
  ctx: MutationCtx,
  snapshot: FlowSnapshot,
): Promise<void> {
  const existing = await ctx.db
    .query('runtimeSnapshots')
    .withIndex('by_flow', (q) =>
      q.eq('namespace', snapshot.namespace).eq('flowId', snapshot.flowId),
    )
    .first()
  const encoded = encodeSnapshot(snapshot) as RuntimeSnapshotRow
  if (existing) await ctx.db.replace(existing._id, encoded)
  else await ctx.db.insert('runtimeSnapshots', encoded)
}

async function markSnapshotDeliveredRecord(
  ctx: MutationCtx,
  workId: WorkId,
  delivery: Parameters<RuntimeStatePort['markSnapshotDelivered']>[1],
): Promise<void> {
  const snapshot = await ctx.db
    .query('runtimeSnapshots')
    .withIndex('by_flow', (q) => q.eq('namespace', delivery.namespace))
    .filter((q) => q.eq(q.field('workId'), workId))
    .first()
  if (!snapshot) return

  const pendingSuspends = (
    snapshot.pendingSuspends as Array<Record<string, unknown>>
  ).map((suspend) =>
    suspend.waiterId === delivery.waiterId
      ? {
          ...suspend,
          delivered: { eventId: delivery.eventId, payload: delivery.payload },
        }
      : suspend,
  )
  const deliveredSuspends = mergeDeliveredSuspend(
    snapshot.deliveredSuspends as Record<string, unknown> | undefined,
    snapshot.pendingSuspends as Array<Record<string, unknown>>,
    delivery.waiterId,
    delivery.eventId,
    delivery.payload,
  )
  await ctx.db.patch(snapshot._id, { pendingSuspends, deliveredSuspends })
}

async function getIdempotencyRecord(
  ctx: MutationCtx,
  namespace: string,
  key: string,
) {
  return await ctx.db
    .query('runtimeIdempotency')
    .withIndex('by_namespace_key', (q) =>
      q.eq('namespace', namespace).eq('key', key),
    )
    .first()
}

async function putIdempotencyRecord(
  ctx: MutationCtx,
  record: IdempotencyRecord,
): Promise<void> {
  const existing = await getIdempotencyRecord(ctx, record.namespace, record.key)
  if (!existing) {
    await ctx.db.insert(
      'runtimeIdempotency',
      encodeIdempotency(record) as RuntimeIdempotencyRow,
    )
  }
}
