import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { staticFileBatchesForShards } from '../src/indexer/shards/discovery'

describe('project shard source batching', () => {
  it('groups static files by owning workspace shard deterministically', () => {
    const root = '/repo'
    const batches = staticFileBatchesForShards(
      [
        join(root, 'packages/lib/src/prompt.ts'),
        join(root, 'packages/app/src/index.ts'),
        join(root, 'packages/app/src/prompt.ts'),
      ],
      [
        { id: '.', root },
        { id: 'packages/app', root: join(root, 'packages/app') },
        { id: 'packages/lib', root: join(root, 'packages/lib') },
      ],
    )

    expect(batches).toEqual([
      {
        shard: expect.objectContaining({ id: 'packages/app' }),
        files: [join(root, 'packages/app/src/index.ts'), join(root, 'packages/app/src/prompt.ts')],
      },
      {
        shard: expect.objectContaining({ id: 'packages/lib' }),
        files: [join(root, 'packages/lib/src/prompt.ts')],
      },
    ])
  })

  it('uses the deepest shard root for nested package ownership', () => {
    const root = '/repo'
    const batches = staticFileBatchesForShards(
      [join(root, 'packages/app/plugin/src/index.ts')],
      [
        { id: '.', root },
        { id: 'packages/app', root: join(root, 'packages/app') },
        { id: 'packages/app/plugin', root: join(root, 'packages/app/plugin') },
      ],
    )

    expect(batches).toEqual([
      {
        shard: expect.objectContaining({ id: 'packages/app/plugin' }),
        files: [join(root, 'packages/app/plugin/src/index.ts')],
      },
    ])
  })
})

