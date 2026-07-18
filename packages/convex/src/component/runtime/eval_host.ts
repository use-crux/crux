import { runtimeCompositeBodies, type RuntimeTargetId, type TaskId, type WorkId } from '@use-crux/core/runtime'
import { v } from 'convex/values'
import { mutation } from '../_generated/server.js'
import { decodeWork, encodeCompositeValue } from '../../runtime-engine/codec'
import { createCompositeTransaction } from './composite_transaction'

const EVAL_EXECUTE_TARGET_ID = '_crux.eval.execute' as RuntimeTargetId

/** Atomically admit one exact Eval job and its durable Runtime outbox row. */
export const admit = mutation({
  args: {
    namespace: v.string(),
    workId: v.string(),
    job: v.any(),
    maxConcurrentJobs: v.number(),
    now: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('runtimeWork')
      .withIndex('by_work_id', (query) => query.eq('workId', args.workId))
      .first()
    if (existing) {
      return encodeCompositeValue({
        kind: 'admitted',
        work: decodeWork(existing),
        created: false,
      })
    }
    const active = await Promise.all(
      ['pending', 'leased'].map((status) =>
        ctx.db
          .query('runtimeWork')
          .withIndex('by_namespace_status_updated', (query) =>
            query.eq('namespace', args.namespace).eq('status', status),
          )
          .take(args.maxConcurrentJobs),
      ),
    )
    if (active[0]!.length + active[1]!.length >= args.maxConcurrentJobs) {
      return { kind: 'capacity' }
    }
    const now = new Date(args.now)
    const work = await runtimeCompositeBodies['task.enqueue'](
      createCompositeTransaction(ctx),
      { newWorkId: () => args.workId as WorkId, now: () => now },
      {
        namespace: args.namespace,
        taskId: String(args.job.jobId) as TaskId,
        targetId: EVAL_EXECUTE_TARGET_ID,
        input: args.job,
      },
    )
    return encodeCompositeValue({ kind: 'admitted', work, created: true })
  },
})
