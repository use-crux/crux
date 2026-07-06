import type {
  RuntimeTimerRecord,
  RuntimeTimerStorePort,
} from '@use-crux/core/runtime'
import type { WithoutSystemFields } from 'convex/server'
import type { Doc } from '../_generated/dataModel.js'
import type { MutationCtx } from '../_generated/server.js'
import { decodeTimer, encodeTimer } from '../../../runtime-engine/codec'
import { randomId } from './shared'
import { unsupported } from './composite-utils'

type RuntimeTimerRow = WithoutSystemFields<Doc<'runtimeTimers'>>

export function createCompositeTimerPort(ctx: MutationCtx): RuntimeTimerStorePort {
  return {
    put: (timer) => putTimerRecord(ctx, timer),
    get: (timerId) => timerById(ctx, timerId),
    claimDue: unsupported('timers.claimDue'),
    list: unsupported('timers.list'),
    listByWork: async (workId) =>
      (
        await ctx.db
          .query('runtimeTimers')
          .withIndex('by_work', (q) => q.eq('workId', workId))
          .collect()
      ).map(decodeTimer),
    transition: (timerId, from, to) =>
      transitionTimerRecord(ctx, timerId, from, to),
    prune: unsupported('timers.prune'),
  }
}

async function putTimerRecord(
  ctx: MutationCtx,
  timer: Parameters<RuntimeTimerStorePort['put']>[0],
): Promise<RuntimeTimerRecord> {
  const record = {
    ...encodeTimer(timer),
    timerId: randomId('timer'),
    state: 'scheduled',
  } as RuntimeTimerRow
  await ctx.db.insert('runtimeTimers', record)
  return decodeTimer(record as unknown)
}

async function transitionTimerRecord(
  ctx: MutationCtx,
  timerId: string,
  from: RuntimeTimerRecord['state'],
  to: RuntimeTimerRecord['state'],
): Promise<boolean> {
  const timer = await timerByIdRecord(ctx, timerId)
  if (!timer || timer.state !== from) return false
  await ctx.db.patch(timer._id, {
    state: to,
    ...(to === 'fired' || to === 'cancelled' ? { settledAt: Date.now() } : {}),
  })
  return true
}

async function timerById(
  ctx: MutationCtx,
  timerId: string,
): Promise<RuntimeTimerRecord | null> {
  const timer = await timerByIdRecord(ctx, timerId)
  return timer ? decodeTimer(timer) : null
}

async function timerByIdRecord(ctx: MutationCtx, timerId: string) {
  return await ctx.db
    .query('runtimeTimers')
    .withIndex('by_timer_id', (q) => q.eq('timerId', timerId))
    .first()
}
