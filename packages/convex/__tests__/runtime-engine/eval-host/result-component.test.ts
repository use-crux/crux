import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import schema from '../../../src/component/schema'

const modules = {
  '../../../src/component/_generated/server.ts': () => import('../../../src/component/_generated/server'),
  '../../../src/component/runtime/results.ts': () => import('../../../src/component/runtime/results'),
} satisfies Record<string, () => Promise<unknown>>

const putResult = makeFunctionReference<
  'mutation',
  {
    namespace: string
    sha256: string
    size: number
    mediaType: string
    location: string
    chunks: string[]
    createdAt: number
  },
  null
>('runtime/results:put')

const getResult = makeFunctionReference<
  'mutation',
  { location: string },
  { chunks: string[]; namespace: string } | null
>('runtime/results:get')

const pruneResults = makeFunctionReference<
  'mutation',
  { namespace: string; before: number; limit: number },
  { removed: number; truncated: boolean }
>('runtime/results:pruneUnreferenced')

describe('Convex Runtime result component', () => {
  it('stores payload chunks separately from result metadata', async () => {
    const t = convexTest({ schema, modules })
    const chunks = ['{"answer":', '"durable"}']

    await t.mutation(putResult, {
      namespace: 'eval-host:production',
      sha256: 'a'.repeat(64),
      size: chunks.join('').length,
      mediaType: 'application/vnd.crux.eval-result+json',
      location: `convex:${'b'.repeat(64)}:sha256:${'a'.repeat(64)}`,
      chunks,
      createdAt: 100,
    })

    await expect(
      t.mutation(getResult, {
        location: `convex:${'b'.repeat(64)}:sha256:${'a'.repeat(64)}`,
      }),
    ).resolves.toMatchObject({
      namespace: 'eval-host:production',
      chunks,
    })
    await expect(t.run(async (ctx) => await ctx.db.query('runtimeResults').collect())).resolves.toHaveLength(1)
    await expect(t.run(async (ctx) => await ctx.db.query('runtimeResultChunks').collect())).resolves.toHaveLength(2)
  })

  it('retains referenced payloads and removes orphaned chunks after work cleanup', async () => {
    const t = convexTest({ schema, modules })
    const sha256 = 'c'.repeat(64)
    const location = `convex:${'d'.repeat(64)}:sha256:${sha256}`
    await t.mutation(putResult, {
      namespace: 'eval-host:production',
      sha256,
      size: 2,
      mediaType: 'application/vnd.crux.eval-result+json',
      location,
      chunks: ['e30='],
      createdAt: 100,
    })
    const workId = await t.run(
      async (ctx) =>
        await ctx.db.insert('runtimeWork', {
          workId: 'eval-job:job-1',
          namespace: 'eval-host:production',
          work: { kind: 'task.run' },
          targetId: '_crux.eval.execute',
          status: 'completed',
          attempt: 1,
          maxAttempts: 8,
          idempotencyKey: 'task:eval-job:job-1',
          resultRef: {
            sha256,
            size: 2,
            mediaType: 'application/vnd.crux.eval-result+json',
            location,
          },
          createdAt: 100,
          updatedAt: 100,
        }),
    )

    await expect(
      t.mutation(pruneResults, {
        namespace: 'eval-host:production',
        before: 200,
        limit: 10,
      }),
    ).resolves.toEqual({ removed: 0, truncated: false })
    await t.run(async (ctx) => await ctx.db.delete(workId))
    await expect(
      t.mutation(pruneResults, {
        namespace: 'eval-host:production',
        before: 200,
        limit: 10,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(t.run(async (ctx) => await ctx.db.query('runtimeResultChunks').collect())).resolves.toEqual([])
  })
})
