import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { resetHooks } from '@use-crux/core'
import { runSessionConformanceTests } from '@use-crux/core/runtime/testing'
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'
import { createPostgresSessionConformanceHarness } from './session-conformance-fixture'

let database: PostgresTestDatabase

beforeAll(async () => {
  database = await startPostgresTestDatabase()
}, 30_000)

afterEach(() => resetHooks())

afterAll(async () => {
  await database?.close()
})

runSessionConformanceTests({
  name: 'PostgreSQL',
  createHarness: async (law) =>
    await createPostgresSessionConformanceHarness(database.url, law),
})

it('retains prepared Session evidence across result pruning and host reconstruction', async () => {
  const harness = await createPostgresSessionConformanceHarness(
    database.url,
    'retention-restart',
  )
  let worker: Awaited<ReturnType<typeof harness.startWorker>> | undefined
  try {
    const conversation = await harness.create('retention-key')
    const turn = await conversation.send({ message: 'retained' })
    worker = await harness.startWorker()
    await expect(turn.result()).resolves.toEqual({ reply: 'Echo: retained' })
    await worker.stop()
    worker = undefined

    await expect(harness.pruneResults()).resolves.toEqual({
      removed: 0,
      truncated: false,
    })
    await harness.reconnect()
    const recovered = await harness.get('retention-key')
    await expect(recovered.inspect()).resolves.toMatchObject({
      checkpoint: { inputId: turn.id },
    })
    await expect(turn.result()).resolves.toEqual({ reply: 'Echo: retained' })
  } finally {
    await worker?.stop()
    await harness.dispose()
  }
})
