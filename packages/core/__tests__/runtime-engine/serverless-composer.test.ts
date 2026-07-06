import { describe, expect, it } from 'vitest'
import {
  CruxRuntimeError,
  createRuntime,
  genericQueue,
  inMemoryRuntimeStore,
  serverless,
  type WakeEnvelope,
} from '@use-crux/core/runtime'

describe('serverless() Runtime Engine composer', () => {
  it('delivers wake envelopes through a generic queue adapter using the resolved public endpoint', async () => {
    const delivered: Array<{
      readonly id: string
      readonly url: string
      readonly envelope: WakeEnvelope
      readonly body: string
      readonly headers: Readonly<Record<string, string>>
    }> = []
    const store = inMemoryRuntimeStore()
    const runtime = createRuntime({
      runtime: serverless({
        store,
        publicUrl: 'https://app.example.com',
        endpoint: '/api/crux',
        namespace: 'tenant-a',
        wake: genericQueue({
          enqueue: async (message) => {
            delivered.push(message)
          },
        }),
      }),
      targets: {},
      newWorkId: () => 'work_1',
    })

    await runtime.deliver({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_1',
      target: 'review',
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_1:event_1',
      attempt: 1,
    })

    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      id: 'resume:work_1:event_1',
      url: 'https://app.example.com/api/crux',
      envelope: { workId: 'work_1', target: 'review' },
    })
    expect(JSON.parse(delivered[0]!.body)).toMatchObject({
      workId: 'work_1',
      target: 'review',
    })
    expect(delivered[0]!.headers).toEqual({})
  })

  it('signs generic queue wake messages when an explicit secret is configured', async () => {
    const delivered: Array<{
      readonly headers: Readonly<Record<string, string>>
    }> = []
    const wake = genericQueue({
      secret: '0123456789abcdef0123456789abcdef',
      enqueue: async (message) => {
        delivered.push(message)
      },
    })
    const runtime = createRuntime({
      runtime: serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        wake,
      }),
      targets: {},
      newWorkId: () => 'work_1',
    })

    await runtime.deliver({
      v: 1,
      ns: 'local',
      workId: 'work_1',
      target: 'review',
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_1:event_1',
      attempt: 1,
    })

    expect(wake.capabilities.signed).toBe(true)
    expect(delivered[0]!.headers['x-crux-signature']).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    )
  })

  it('rejects generic queue HMAC secrets that are too short', () => {
    expect(() =>
      genericQueue({
        secret: 'too-short',
        enqueue: async () => undefined,
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      genericQueue({
        secret: 'too-short',
        enqueue: async () => undefined,
      }),
    ).toThrow(/Code: WAKE_UNVERIFIED/)
  })

  it('passes retention config through serverless runtime resolution', async () => {
    const store = inMemoryRuntimeStore()
    const runtime = createRuntime({
      runtime: serverless({
        store,
        publicUrl: 'https://app.example.com',
        wake: genericQueue({ enqueue: async () => undefined }),
        retention: { events: '1ms', sweepLimit: 10 },
      }),
      targets: {},
      newWorkId: () => 'work_1',
      startMaintenance: false,
    })

    await store.events.append({
      namespace: runtime.namespace,
      name: 'document.approved',
      payload: { documentId: 'doc_1' },
    })

    await expect(
      runtime.maintenance.tick({
        now: new Date('2999-01-01T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ retainedRecordsRemoved: 1 })
  })

  it('rejects idempotency retention shorter than the wake horizon', () => {
    expect(() =>
      createRuntime({
        runtime: serverless({
          store: inMemoryRuntimeStore(),
          publicUrl: 'https://app.example.com',
          wake: genericQueue({
            maxDelayMs: 7 * 24 * 60 * 60 * 1_000,
            enqueue: async () => undefined,
          }),
          retention: { idempotencyKeys: '1d' },
        }),
        targets: {},
        newWorkId: () => 'work_1',
        startMaintenance: false,
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      createRuntime({
        runtime: serverless({
          store: inMemoryRuntimeStore(),
          publicUrl: 'https://app.example.com',
          wake: genericQueue({
            maxDelayMs: 7 * 24 * 60 * 60 * 1_000,
            enqueue: async () => undefined,
          }),
          retention: { idempotencyKeys: '1d' },
        }),
        targets: {},
        newWorkId: () => 'work_1',
        startMaintenance: false,
      }),
    ).toThrow(/retention\.idempotencyKeys/)
  })

  it('fails production setup when no stable public URL can be resolved', () => {
    expect(() =>
      serverless({
        store: inMemoryRuntimeStore(),
        wake: genericQueue({ enqueue: async () => undefined }),
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      serverless({
        store: inMemoryRuntimeStore(),
        wake: genericQueue({ enqueue: async () => undefined }),
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(/Code: PUBLIC_URL_UNRESOLVED/)
  })

  it('infers Vercel production URLs with https and the configured endpoint', async () => {
    const delivered: Array<{ readonly url: string }> = []
    const runtime = createRuntime({
      runtime: serverless({
        store: inMemoryRuntimeStore(),
        endpoint: 'api/runtime',
        env: {
          NODE_ENV: 'production',
          VERCEL_PROJECT_PRODUCTION_URL: 'crux-app.vercel.app',
        },
        wake: genericQueue({
          enqueue: async (message) => {
            delivered.push(message)
          },
        }),
      }),
      targets: {},
      newWorkId: () => 'work_1',
    })

    await runtime.deliver({
      v: 1,
      ns: 'local',
      workId: 'work_1',
      target: 'review',
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_1:event_1',
      attempt: 1,
    })

    expect(delivered).toMatchObject([
      { url: 'https://crux-app.vercel.app/api/runtime' },
    ])
  })
})
