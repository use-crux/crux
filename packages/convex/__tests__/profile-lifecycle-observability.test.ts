import {
  acceptedDeliveryReceipt,
  configureObservability,
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCruxConvex, type ConvexCtxPort } from '../src'
import { inMemoryRecordStore } from '../src/memory'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS } from '../src/observability'

describe('createCruxConvex().run() lifecycle ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('awaits one bounded terminal observability flush before resolving the application result', async () => {
    const transport = createInMemoryObservabilityTransport()
    let releaseSend!: () => void
    let markSendStarted!: () => void
    const sendStarted = new Promise<void>((resolve) => {
      markSendStarted = resolve
    })
    setObservabilityTransport({
      async send(records) {
        markSendStarted()
        await new Promise<void>((resolve) => {
          releaseSend = resolve
        })
        const receipt = acceptedDeliveryReceipt(records)
        await transport.send(records)
        return receipt
      },
    }, { scheduledDelayMs: 60_000 })
    const flush = vi.spyOn(observe, 'flush')
    const crux = createProfile()
    let settled = false

    const running = crux.run(createCtx(), { threadId: 'thread-success' }, async () => {
      observe.openRun({ name: 'convex-profile-run', rootPrimitive: 'run' }).end()
      return { ok: true } as const
    }).then((result) => {
      settled = true
      return result
    })

    await sendStarted
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    releaseSend()
    const result = await running

    expect(result).toEqual({ ok: true })
    expect(flush).toHaveBeenCalledWith({
      timeoutMs: DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS,
    })
    expect(
      transport.records.filter(
        (record) => record.type === 'run:start' && record.name === 'convex-profile-run',
      ),
    ).toHaveLength(1)
  })

  it('preserves the original application error when the terminal exporter throws', async () => {
    const original = new Error('convex application failed')
    vi.spyOn(observe, 'flush').mockRejectedValue(new Error('convex exporter failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const crux = createProfile()

    await expect(
      crux.run(createCtx(), { threadId: 'thread-error' }, async () => {
        throw original
      }),
    ).rejects.toBe(original)

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Convex'),
      expect.objectContaining({ message: 'convex exporter failed' }),
    )
  })

  it('flushes evidence emitted before request-scoped storage creation rejects', async () => {
    const original = new Error('convex storage failed')
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 })
    const crux = createCruxConvex({
      components: {
        crux: { marker: 'crux' } as never,
        agent: { marker: 'agent' } as never,
      },
      storage: {
        create: async () => {
          observe.openRun({ name: 'convex-storage-failure', rootPrimitive: 'run' }).end()
          throw original
        },
      },
    })

    await expect(crux.run(createCtx(), undefined, async () => undefined)).rejects.toBe(original)
    expect(transport.records).toContainEqual(
      expect.objectContaining({ type: 'run:start', name: 'convex-storage-failure' }),
    )
  })

  it('reports an incomplete terminal drain through existing diagnostics without changing the result', async () => {
    vi.spyOn(observe, 'flush').mockResolvedValue({
      status: 'deadline',
      delivered: 1,
      rejected: 0,
      remaining: 2,
      deadlineExceeded: true,
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const crux = createProfile()

    await expect(
      crux.run(createCtx(), undefined, async () => 'convex-result' as const),
    ).resolves.toBe('convex-result')

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('did not fully complete'),
      expect.objectContaining({ status: 'deadline', remaining: 2 }),
    )
  })

  it('retains deployment identity across the async profile carrier', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 60_000 })
    const identity = {
      projectId: 'convex-project',
      manifestId: `pim_${'a'.repeat(64)}` as const,
      deploymentId: 'convex-production-42',
    }
    configureObservability({ identity })
    const crux = createProfile()

    await crux.run(createCtx(), { threadId: 'thread-identity' }, async () => {
      await Promise.resolve()
      observe.openRun({ name: 'convex-profile-identity', rootPrimitive: 'run' }).end()
    })

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'run:start',
        name: 'convex-profile-identity',
        deployment: identity,
      }),
    )
  })
})

function createProfile() {
  return createCruxConvex({
    components: {
      crux: { marker: 'crux' } as never,
      agent: { marker: 'agent' } as never,
    },
    storage: { create: () => inMemoryRecordStore() },
  })
}

function createCtx(): ConvexCtxPort {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
  }
}
