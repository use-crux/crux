import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import schema from '../../../src/component/schema'

const modules = {
  '../../../src/component/_generated/server.ts': () => import('../../../src/component/_generated/server'),
  '../../../src/component/runtime/eval_host.ts': () => import('../../../src/component/runtime/eval_host'),
} satisfies Record<string, () => Promise<unknown>>

const admit = makeFunctionReference<
  'mutation',
  {
    namespace: string
    workId: string
    job: Record<string, unknown>
    maxConcurrentJobs: number
    now: number
  },
  { kind: 'admitted'; work: Record<string, unknown>; created: boolean }
>('runtime/eval_host:admit')

describe('Convex Eval host admission component', () => {
  it('atomically selects one work/outbox winner across duplicate action retries', async () => {
    const t = convexTest({ schema, modules })
    const args = {
      namespace: 'eval-host:production',
      workId: 'eval-job:job-1',
      job: { jobId: 'job-1', evalRunId: 'run-1' },
      maxConcurrentJobs: 4,
      now: 100,
    }

    const first = await t.mutation(admit, args)
    const retry = await t.mutation(admit, args)

    expect(first).toMatchObject({ kind: 'admitted', created: true })
    expect(retry).toMatchObject({
      kind: 'admitted',
      created: false,
      work: first.work,
    })
    await expect(t.run(async (ctx) => await ctx.db.query('runtimeWork').collect())).resolves.toHaveLength(1)
    await expect(t.run(async (ctx) => await ctx.db.query('runtimeOutbox').collect())).resolves.toHaveLength(1)
  })
})
