import { describe, expect, it } from 'vitest'
import {
  createRuntime,
  createRuntimeHandler,
  encodeWakeEnvelope,
  genericQueue,
  inMemoryRuntimeStore,
  serverless,
  task,
  wakeEnvelopeForWork,
  type RuntimeWakeMessage,
  type TaskId,
  type WorkId,
} from '@use-crux/core/runtime'

describe('HTTP wake HMAC verification', () => {
  it('fails closed for missing, malformed, unknown-scheme, and mismatched signatures', async () => {
    const store = inMemoryRuntimeStore()
    const delivered: RuntimeWakeMessage[] = []
    let executed = 0
    const embedDocument = task('hmac-verified-task', {
      run: () => {
        executed += 1
      },
    })
    const runtimeDefinition = serverless({
      store,
      publicUrl: 'https://app.example.com',
      wake: genericQueue({
        secret: '0123456789abcdef0123456789abcdef',
        enqueue: async (message) => {
          delivered.push(message)
        },
      }),
    })
    const { POST } = createRuntimeHandler({
      runtime: runtimeDefinition,
      targets: [embedDocument],
      newWorkId: () => 'work_hmac_1' as WorkId,
    })
    const runtime = createRuntime({
      runtime: runtimeDefinition,
      targets: { [embedDocument.name]: embedDocument },
      newWorkId: () => 'work_hmac_1' as WorkId,
      startMaintenance: false,
    })
    const work = await runtime.kernel.enqueueTask({
      namespace: 'local',
      taskId: 'task_hmac_1' as TaskId,
      targetId: embedDocument.targetId,
      input: {},
    })
    await runtime.dispatcher.nudge()
    const message = delivered[0]!

    expect(message.body).toBe(encodeWakeEnvelope(wakeEnvelopeForWork(work)))
    for (const headers of [
      {},
      { 'x-crux-signature': 'sha256=not-hex' },
      { 'x-crux-signature': `sha512=${'0'.repeat(128)}` },
      { 'x-crux-signature': `sha256=${'0'.repeat(64)}` },
    ]) {
      await expect(
        POST(
          new Request('https://app.example.com/api/crux', {
            method: 'POST',
            headers,
            body: message.body,
          }),
        ),
      ).resolves.toMatchObject({ status: 401 })
    }
    expect(executed).toBe(0)
    await expect(
      store.state.hasIdempotencyKey('local', work.idempotencyKey),
    ).resolves.toBe(false)
    await expect(
      store.state.getWork(work.workId, { namespace: 'local' }),
    ).resolves.toMatchObject({ status: 'pending' })

    await expect(
      POST(
        new Request('https://app.example.com/api/crux', {
          method: 'POST',
          headers: message.headers,
          body: message.body,
        }),
      ),
    ).resolves.toMatchObject({ status: 200 })
    expect(executed).toBe(1)
  })
})
