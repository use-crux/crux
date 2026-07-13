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
  it('uses an explicit namespace ahead of environment and Vercel inference', () => {
    const definition = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      namespace: 'tenant-a',
      env: {
        NODE_ENV: 'production',
        CRUX_RUNTIME_NAMESPACE: 'environment',
        VERCEL_ENV: 'production',
      },
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(definition).toMatchObject({
      namespace: 'tenant-a',
      namespaceSource: 'explicit',
    })
  })

  it('treats a blank explicit namespace as unset', () => {
    const definition = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      namespace: ' \t ',
      env: { CRUX_RUNTIME_NAMESPACE: 'tenant-b' },
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(definition).toMatchObject({
      namespace: 'tenant-b',
      namespaceSource: 'env',
    })
  })

  it('uses a non-empty environment namespace and treats blank values as unset', () => {
    const configured = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: { CRUX_RUNTIME_NAMESPACE: ' tenant-a ' },
      wake: genericQueue({ enqueue: async () => undefined }),
    })
    const blank = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: { CRUX_RUNTIME_NAMESPACE: ' \t ' },
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(configured).toMatchObject({
      namespace: 'tenant-a',
      namespaceSource: 'env',
    })
    expect(blank).toMatchObject({
      namespace: 'local',
      namespaceSource: 'fallback',
    })
  })

  it('uses the local namespace fallback outside production', () => {
    const definition = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: {},
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(definition).toMatchObject({
      namespace: 'local',
      namespaceSource: 'fallback',
    })
  })

  it('infers Vercel production and preview namespaces', () => {
    const production = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: { NODE_ENV: 'production', VERCEL_ENV: 'production' },
      wake: genericQueue({ enqueue: async () => undefined }),
    })
    const preview = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: {
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'Feature/Foo',
      },
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(production).toMatchObject({
      namespace: 'production',
      namespaceSource: 'inferred',
    })
    expect(preview).toMatchObject({
      namespace: 'preview-feature-foo',
      namespaceSource: 'inferred',
    })
  })

  it('treats preview refs that sanitize to nothing as an unavailable signal', () => {
    const emptyRef = () =>
      serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        wake: genericQueue({ enqueue: async () => undefined }),
        env: {
          NODE_ENV: 'production',
          VERCEL_ENV: 'preview',
          VERCEL_GIT_COMMIT_REF: '日本語🔥',
        },
      })
    const devEmptyRef = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      wake: genericQueue({ enqueue: async () => undefined }),
      env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: '' },
    })

    expect(emptyRef).toThrow(/Code: NAMESPACE_AMBIGUOUS/)
    expect(devEmptyRef).toMatchObject({
      namespace: 'local',
      namespaceSource: 'fallback',
    })
  })

  it('sanitizes Vercel preview branch names deterministically', () => {
    const definition = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: {
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: '--FEATURE///🔥foo__bar---',
      },
      wake: genericQueue({ enqueue: async () => undefined }),
    })
    const capped = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: {
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_GIT_COMMIT_REF: 'a'.repeat(65),
      },
      wake: genericQueue({ enqueue: async () => undefined }),
    })

    expect(definition.namespace).toBe('preview-feature-foo__bar')
    expect(capped.namespace).toBe(`preview-${'a'.repeat(64)}`)
  })

  it('rejects ambiguous production namespaces before public URL resolution', () => {
    const ambiguous = () =>
      serverless({
        store: inMemoryRuntimeStore(),
        wake: genericQueue({ enqueue: async () => undefined }),
        env: { NODE_ENV: 'production' },
      })
    const previewWithoutRef = () =>
      serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        wake: genericQueue({ enqueue: async () => undefined }),
        env: { NODE_ENV: 'production', VERCEL_ENV: 'preview' },
      })

    expect(ambiguous).toThrow(CruxRuntimeError)
    expect(ambiguous).toThrow(/Code: NAMESPACE_AMBIGUOUS/)
    expect(ambiguous).toThrow(
      'Set CRUX_RUNTIME_NAMESPACE=production or pass serverless({ namespace: "..." }).',
    )
    expect(previewWithoutRef).toThrow(/Code: NAMESPACE_AMBIGUOUS/)
  })

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
        namespace: 'test',
        wake: genericQueue({ enqueue: async () => undefined }),
        env: { NODE_ENV: 'production' },
      }),
    ).toThrow(CruxRuntimeError)
    expect(() =>
      serverless({
        store: inMemoryRuntimeStore(),
        namespace: 'test',
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
        namespace: 'test',
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
