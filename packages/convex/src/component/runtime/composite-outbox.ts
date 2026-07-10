import type {
  RuntimeOutboxItem,
  RuntimeOutboxPort,
  WakeEnvelope,
} from '@use-crux/core/runtime'
import type { MutationCtx } from '../_generated/server.js'
import {
  decodeOutbox,
  encodeWakeEnvelope,
} from '../../runtime-engine/codec'
import { limitRows, randomId } from './shared'
import { unsupported } from './composite-utils'

export function createCompositeOutboxPort(ctx: MutationCtx): RuntimeOutboxPort {
  return {
    put: (envelope, options) =>
      putOutboxRecord(ctx, envelope, options?.deliverAt ?? new Date()),
    get: (outboxId) => outboxById(ctx, outboxId),
    claimPending: unsupported('outbox.claimPending'),
    list: (query) => listOutboxRecords(ctx, query),
    listByWork: (workId, options) => listOutboxRecordsByWork(ctx, workId, options),
    confirm: unsupported('outbox.confirm'),
    retryLater: unsupported('outbox.retryLater'),
    prune: unsupported('outbox.prune'),
  }
}

async function putOutboxRecord(
  ctx: MutationCtx,
  envelope: WakeEnvelope,
  deliverAt: Date,
): Promise<RuntimeOutboxItem> {
  const nextAttemptAt = deliverAt.getTime()
  const existing = await ctx.db
    .query('runtimeOutbox')
    .withIndex('by_namespace_state_next', (q) =>
      q.eq('namespace', envelope.ns).eq('state', 'pending').eq('nextAttemptAt', nextAttemptAt),
    )
    .filter((q) => q.eq(q.field('envelope.idempotencyKey'), envelope.idempotencyKey))
    .first()
  if (existing) return decodeOutbox(existing)

  const record = {
    outboxId: randomId('outbox'),
    namespace: envelope.ns,
    workId: envelope.workId,
    envelope: encodeWakeEnvelope(envelope),
    state: 'pending',
    attempts: 0,
    nextAttemptAt,
  }
  await ctx.db.insert('runtimeOutbox', record)
  return decodeOutbox(record)
}

async function listOutboxRecords(
  ctx: MutationCtx,
  query: Parameters<RuntimeOutboxPort['list']>[0],
): Promise<readonly RuntimeOutboxItem[]> {
  const states = query.state === undefined
    ? ['pending', 'dispatched', 'confirmed']
    : [query.state]
  const rows = (
    await Promise.all(
      states.map((state) =>
        ctx.db
          .query('runtimeOutbox')
          .withIndex('by_namespace_state_next', (q) =>
            q.eq('namespace', query.namespace).eq('state', state),
          )
          .take(query.limit ?? 1_000),
      ),
    )
  ).flat()
  return limitRows(rows.map(decodeOutbox), query.limit)
}

async function listOutboxRecordsByWork(
  ctx: MutationCtx,
  workId: Parameters<RuntimeOutboxPort['listByWork']>[0],
  options: Parameters<RuntimeOutboxPort['listByWork']>[1] = {},
): Promise<readonly RuntimeOutboxItem[]> {
  const states = options.state === undefined
    ? ['pending', 'dispatched', 'confirmed']
    : [options.state]
  const namespace = options.namespace
  const rows = (
    await Promise.all(
      states.map((state) => {
        if (namespace) {
          return ctx.db
            .query('runtimeOutbox')
            .withIndex('by_work_namespace_state_next', (q) =>
              q.eq('workId', workId).eq('namespace', namespace).eq('state', state),
            )
            .take(options.limit ?? 1_000)
        }
        return ctx.db
          .query('runtimeOutbox')
          .withIndex('by_work_state_next', (q) =>
            q.eq('workId', workId).eq('state', state),
          )
          .take(options.limit ?? 1_000)
      }),
    )
  ).flat()
  return limitRows(rows.map(decodeOutbox), options.limit)
}

async function outboxById(
  ctx: MutationCtx,
  outboxId: string,
): Promise<RuntimeOutboxItem | null> {
  const item = await ctx.db
    .query('runtimeOutbox')
    .withIndex('by_outbox_id', (q) => q.eq('outboxId', outboxId))
    .first()
  return item ? decodeOutbox(item) : null
}
