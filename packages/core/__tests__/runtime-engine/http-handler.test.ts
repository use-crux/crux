import { describe, expect, it } from 'vitest'
import {
  allowUnsignedDevWake,
  CruxRuntimeError,
  createRuntimeProgram,
  createRuntimeHandler,
  encodeWakeEnvelope,
  inMemoryRuntimeStore,
  node,
  serverless,
  durableTask,
  wakeEnvelopeForWork,
  type TaskId,
  type WorkId,
} from '@use-crux/core/runtime'

describe('createRuntimeHandler', () => {
  it('uses a Runtime program as the authoritative targets and manifest', async () => {
    const target = durableTask('program-handler-target', {
      run: () => undefined,
    })
    const program = createRuntimeProgram({ targets: [target], transports: [] })
    const { GET } = createRuntimeHandler({
      runtime: node({
        store: inMemoryRuntimeStore(),
        namespace: 'program-handler-test',
        autoStartMaintenance: false,
      }),
      program,
    })

    await expect(
      GET(new Request('https://example.com/api/crux')).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      manifestHash: program.manifestHash,
      targets: [target.name],
    })
  })

  it('fails closed in production when no wake verifier is configured', () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() =>
        createRuntimeHandler({
          runtime: node({
            store: inMemoryRuntimeStore(),
            namespace: 'tenant-a',
            autoStartMaintenance: false,
          }),
          targets: [],
        }),
      ).toThrow(CruxRuntimeError)
      expect(() =>
        createRuntimeHandler({
          runtime: node({
            store: inMemoryRuntimeStore(),
            namespace: 'tenant-a',
            autoStartMaintenance: false,
          }),
          targets: [],
        }),
      ).toThrow(/Code: WAKE_UNVERIFIED/)
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('allows unsigned wake requests in production only when explicitly configured', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const { GET } = createRuntimeHandler({
        runtime: node({
          store: inMemoryRuntimeStore(),
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [],
        verify: allowUnsignedDevWake,
      })

      await expect(
        GET(new Request('https://example.com/api/crux')),
      ).resolves.toMatchObject({ status: 200 })
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('keeps unsigned wake requests available by default in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const { GET } = createRuntimeHandler({
        runtime: node({
          store: inMemoryRuntimeStore(),
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [],
      })

      await expect(
        GET(new Request('https://example.com/api/crux')),
      ).resolves.toMatchObject({ status: 200 })
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('rejects unverified wake requests before durable writes or target execution', async () => {
    const store = inMemoryRuntimeStore()
    let executed = false
    const embedDocument = durableTask('embed-document', {
      run: () => {
        executed = true
      },
    })
    const runtime = node({
      store,
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const { POST } = createRuntimeHandler({
      runtime,
      targets: [embedDocument],
      verify: async () => false,
      newWorkId: () => 'work_task_1' as WorkId,
    })
    const work = await store.state.createWork({
      workId: 'work_task_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_1' as TaskId,
        targetId: embedDocument.targetId,
        input: {},
      },
      targetId: embedDocument.targetId,
      idempotencyKey: 'task:work_task_1',
      now: new Date('2026-07-02T00:00:00.000Z'),
    })

    const response = await POST(
      new Request('https://example.com/api/crux', {
        method: 'POST',
        body: encodeWakeEnvelope(wakeEnvelopeForWork(work)),
      }),
    )

    expect(response.status).toBe(401)
    expect(executed).toBe(false)
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'task:work_task_1'),
    ).resolves.toBe(false)
    await expect(
      store.state.getWork('work_task_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })
  })

  it('returns a terminal client response for verified malformed wake envelopes', async () => {
    const store = inMemoryRuntimeStore()
    const { POST } = createRuntimeHandler({
      runtime: node({
        store,
        namespace: 'tenant-a',
        autoStartMaintenance: false,
      }),
      targets: [],
      verify: async () => true,
    })

    const response = await POST(
      new Request('https://example.com/api/crux', {
        method: 'POST',
        body: '{bad json',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      outcome: 'invalid-envelope',
    })
  })

  it('maps processed, duplicate, and busy kernel outcomes to the HTTP protocol', async () => {
    const store = inMemoryRuntimeStore()
    const seenInputs: unknown[] = []
    const embedDocument = durableTask('embed-document-http-status', {
      run: (input: { documentId: string }) => {
        seenInputs.push(input)
      },
    })
    const { POST } = createRuntimeHandler({
      runtime: node({
        store,
        namespace: 'tenant-a',
        autoStartMaintenance: false,
      }),
      targets: [embedDocument],
      verify: async () => true,
      newWorkId: () => 'work_task_2' as WorkId,
    })
    const work = await store.state.createWork({
      workId: 'work_task_2' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_2' as TaskId,
        targetId: embedDocument.targetId,
        input: { documentId: 'doc_1' },
      },
      targetId: embedDocument.targetId,
      idempotencyKey: 'task:work_task_2',
      now: new Date('2026-07-02T00:00:00.000Z'),
    })
    const request = () =>
      new Request('https://example.com/api/crux', {
        method: 'POST',
        body: encodeWakeEnvelope(wakeEnvelopeForWork(work)),
      })

    await expect(POST(request())).resolves.toMatchObject({ status: 200 })
    expect(seenInputs).toEqual([{ documentId: 'doc_1' }])

    await expect(POST(request())).resolves.toMatchObject({ status: 200 })
    expect(seenInputs).toEqual([{ documentId: 'doc_1' }])

    const busyWork = await store.state.createWork({
      workId: 'work_busy_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_busy_1' as TaskId,
        targetId: embedDocument.targetId,
        input: {},
      },
      targetId: embedDocument.targetId,
      idempotencyKey: 'task:work_busy_1',
      now: new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.leases.claim('work:work_busy_1', { ttlMs: 60_000 })

    await expect(
      POST(
        new Request('https://example.com/api/crux', {
          method: 'POST',
          body: encodeWakeEnvelope(wakeEnvelopeForWork(busyWork)),
        }),
      ),
    ).resolves.toMatchObject({ status: 409 })
  })

  it('throws TARGET_DUPLICATE when an entry file exposes the same target twice', () => {
    const store = inMemoryRuntimeStore()
    const first = durableTask('duplicate-runtime-target', { run: () => undefined })
    const second = durableTask('duplicate-runtime-target', { run: () => undefined })

    expect(() =>
      createRuntimeHandler({
        runtime: node({
          store,
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [first, second],
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      createRuntimeHandler({
        runtime: node({
          store,
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [first, second],
      }),
    ).toThrow(/Code: TARGET_DUPLICATE/)
  })

  it('throws TARGET_NOT_FOUND when a name-only target cannot be resolved', () => {
    const store = inMemoryRuntimeStore()

    expect(() =>
      createRuntimeHandler({
        runtime: node({
          store,
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [{ name: 'missing-runtime-target' }],
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      createRuntimeHandler({
        runtime: node({
          store,
          namespace: 'tenant-a',
          autoStartMaintenance: false,
        }),
        targets: [{ name: 'missing-runtime-target' }],
      }),
    ).toThrow(/Code: TARGET_NOT_FOUND/)
  })

  it('uses the configured wake adapter verifier when no override is supplied', async () => {
    const store = inMemoryRuntimeStore()
    const embedDocument = durableTask('verified-by-wake-adapter', {
      run: () => undefined,
    })
    const runtime = serverless({
      store,
      publicUrl: 'https://app.example.com',
      wake: {
        id: 'test-wake',
        capabilities: { signed: true },
        verify: async ({ request }) =>
          request.headers.get('x-test-signature') === 'ok',
        createWake: () => async () => undefined,
      },
    })
    const { GET, POST } = createRuntimeHandler({
      runtime,
      targets: [embedDocument],
      manifestHash: 'sha256:runtime-manifest',
      newWorkId: () => 'work_verified_1' as WorkId,
    })
    const work = await store.state.createWork({
      workId: 'work_verified_1' as WorkId,
      namespace: 'local',
      work: {
        kind: 'task.run',
        taskId: 'task_verified_1' as TaskId,
        targetId: embedDocument.targetId,
        input: {},
      },
      targetId: embedDocument.targetId,
      idempotencyKey: 'task:work_verified_1',
      now: new Date('2026-07-02T00:00:00.000Z'),
    })
    const body = encodeWakeEnvelope(wakeEnvelopeForWork(work))

    await expect(
      POST(
        new Request('https://app.example.com/api/crux', {
          method: 'POST',
          body,
        }),
      ),
    ).resolves.toMatchObject({ status: 401 })
    await expect(
      POST(
        new Request('https://app.example.com/api/crux', {
          method: 'POST',
          headers: { 'x-test-signature': 'ok' },
          body,
        }),
      ),
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      GET(new Request('https://app.example.com/api/crux')),
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      GET(new Request('https://app.example.com/api/crux')).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      namespace: 'local',
      manifestHash: 'sha256:runtime-manifest',
    })
  })
})
