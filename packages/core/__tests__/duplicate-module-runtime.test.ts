import { afterEach, describe, expect, it, vi } from 'vitest'

describe('duplicate module runtime state', () => {
  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.resetModules()
    const core = await import('../src/index')
    core.resetHooks()
    core.resetObservabilityRuntime()
  })

  it('observes instrumentation config from an isolated action-side module copy', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const envelope = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({ accepted: envelope.records.length, rejected: [] }),
        { status: 202 },
      )
    })
    vi.stubGlobal('fetch', fetchImpl)

    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const crux = instrumentationCore.config({
      observability: {
        serverUrl: 'https://collector.example.com',
        token: 'instrumentation-token',
      },
    })

    vi.resetModules()
    const actionCore = await import('../src/index')

    try {
      await actionCore.observe.run(
        { name: 'server action', rootPrimitive: 'custom.operation' },
        async () => 'ok',
      )
      await actionCore.observe.flush({ timeoutMs: 100 })

      expect(fetchImpl).toHaveBeenCalled()
      expect(String(fetchImpl.mock.calls[0][0])).toBe(
        'https://collector.example.com/api/observability/records',
      )
      expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer instrumentation-token',
      })
    } finally {
      crux.dispose()
    }
  }, 30_000)

  it('removes shared observability config from another copy on dispose', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const crux = instrumentationCore.config({
      observability: { serverUrl: 'https://collector.example.com' },
    })
    vi.resetModules()
    const actionCore = await import('../src/index')

    crux.dispose()
    await actionCore.observe.run(
      { name: 'disposed server action', rootPrimitive: 'custom.operation' },
      async () => 'ok',
    )
    await actionCore.observe.flush({ timeoutMs: 100 })

    expect(actionCore.currentObservabilityTransport()).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  }, 30_000)

  it("cancels another copy's queued delivery immediately on dispose", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const send = vi.fn(instrumentationCore.acceptedDeliveryReceipt)
    const crux = instrumentationCore.config({
      observability: {
        transport: { send },
        delivery: { scheduledDelayMs: 1_000 },
      },
    })

    vi.resetModules()
    const actionCore = await import('../src/index')
    actionCore.observe.openRun({
      name: 'queued before dispose',
      rootPrimitive: 'custom.operation',
    })

    crux.dispose()

    expect(send).not.toHaveBeenCalled()
    expect(actionCore.observabilityDiagnostics()).toMatchObject({
      queuedRecords: 0,
      reconfiguredDroppedRecords: 1,
    })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).not.toHaveBeenCalled()
  })

  it('propagates an observability reset across module copies', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const crux = instrumentationCore.config({
      observability: { serverUrl: 'https://collector.example.com' },
    })
    vi.resetModules()
    const actionCore = await import('../src/index')

    try {
      actionCore.resetObservabilityRuntime()
      await instrumentationCore.observe.run(
        { name: 'reset instrumentation', rootPrimitive: 'custom.operation' },
        async () => 'ok',
      )
      await instrumentationCore.observe.flush({ timeoutMs: 100 })

      expect(
        instrumentationCore.currentObservabilityTransport(),
      ).toBeUndefined()
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      crux.dispose()
    }
  }, 30_000)

  it('clears another copy\'s subscribers, error count, and warning state on reset', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.resetModules()
    const firstCore = await import('../src/index')
    const staleSubscriber = vi.fn(() => {
      throw new Error('subscriber failed')
    })
    firstCore.subscribeObservability(staleSubscriber)
    firstCore.observe.openRun({
      name: 'before reset',
      rootPrimitive: 'custom.operation',
    })

    expect(firstCore.observabilityDiagnostics().subscriberErrors).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)

    vi.resetModules()
    const secondCore = await import('../src/index')
    secondCore.resetObservabilityRuntime()

    expect(firstCore.observabilityDiagnostics().subscriberErrors).toBe(0)
    const staleCallCount = staleSubscriber.mock.calls.length
    firstCore.subscribeObservability(() => {
      throw new Error('subscriber failed after reset')
    })
    firstCore.observe.openRun({
      name: 'after reset',
      rootPrimitive: 'custom.operation',
    })

    expect(staleSubscriber).toHaveBeenCalledTimes(staleCallCount)
    expect(firstCore.observabilityDiagnostics().subscriberErrors).toBe(1)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('clears another copy\'s sequencer and terminal-run state on reset', async () => {
    vi.resetModules()
    const firstCore = await import('../src/index')
    const beforeReset: number[] = []
    firstCore.subscribeObservability(['span:event'], (record) =>
      beforeReset.push(record.segmentSeq),
    )
    const activeRun = firstCore.observe.openRun({
      name: 'active across reset',
      rootPrimitive: 'custom.operation',
    })
    const activeSpan = activeRun.withContext(() =>
      firstCore.observe.openSpan({
        name: 'active span',
        primitive: 'custom.operation',
      }),
    )
    activeSpan.withContext(() => firstCore.observe.event({ name: 'before reset' }))
    activeSpan.withContext(() => firstCore.observe.event({ name: 'before reset again' }))
    expect(beforeReset.at(-1)).toBeGreaterThan(1)

    vi.resetModules()
    const secondCore = await import('../src/index')
    secondCore.resetObservabilityRuntime()

    const afterReset: number[] = []
    firstCore.subscribeObservability(['span:event'], (record) =>
      afterReset.push(record.segmentSeq),
    )
    activeSpan.withContext(() => firstCore.observe.event({ name: 'after reset' }))
    expect(afterReset).toEqual([1])
    activeSpan.end()
    activeRun.end()

    const terminalRun = firstCore.observe.openRun({
      name: 'terminal before reset',
      rootPrimitive: 'custom.operation',
    })
    const continuation = terminalRun.captureContinuation()
    terminalRun.end()
    expect(() =>
      firstCore.observe.resumeRun(continuation, { reason: 'too early' }),
    ).toThrow('Cannot resume a terminal observed run')

    secondCore.resetObservabilityRuntime()

    const resumed = firstCore.observe.resumeRun(continuation, {
      reason: 'after reset',
    })
    resumed.end()
  })

  it("cancels another copy's queued delivery immediately on reset", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const send = vi.fn(instrumentationCore.acceptedDeliveryReceipt)
    instrumentationCore.setObservabilityTransport(
      { send },
      { scheduledDelayMs: 1_000 },
    )

    vi.resetModules()
    const actionCore = await import('../src/index')
    actionCore.observe.openRun({
      name: 'queued before reset',
      rootPrimitive: 'custom.operation',
    })

    instrumentationCore.resetObservabilityRuntime()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(send).not.toHaveBeenCalled()
    expect(actionCore.observabilityDiagnostics()).toMatchObject({
      queuedRecords: 0,
      reconfiguredDroppedRecords: 1,
    })
  })

  it("preserves another copy's queued records for the replacement transport", async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const instrumentationCore = await import('../src/index')
    const oldSend = vi.fn(instrumentationCore.acceptedDeliveryReceipt)
    const newSend = vi.fn(instrumentationCore.acceptedDeliveryReceipt)
    instrumentationCore.setObservabilityTransport(
      { send: oldSend },
      { scheduledDelayMs: 1_000 },
    )

    vi.resetModules()
    const actionCore = await import('../src/index')
    actionCore.observe.openRun({
      name: 'queued before replacement',
      rootPrimitive: 'custom.operation',
    })

    instrumentationCore.setObservabilityTransport(
      { send: newSend },
      { scheduledDelayMs: 1_000 },
    )

    expect(actionCore.observabilityDiagnostics()).toMatchObject({
      queuedRecords: 1,
      reconfiguredDroppedRecords: 0,
    })

    await actionCore.observe.flush({ timeoutMs: 100 })

    expect(oldSend).not.toHaveBeenCalled()
    expect(newSend).toHaveBeenCalledTimes(1)
    expect(actionCore.observabilityDiagnostics()).toMatchObject({
      queuedRecords: 0,
      reconfiguredDroppedRecords: 0,
      acceptedRecords: 1,
    })
  })

  it('does not let a pre-reset restore clobber post-reset configuration', async () => {
    vi.resetModules()
    const firstCore = await import('../src/index')
    const restoreOld = firstCore.setObservabilityTransport({
      send: firstCore.acceptedDeliveryReceipt,
    })

    vi.resetModules()
    const secondCore = await import('../src/index')
    secondCore.resetObservabilityRuntime()
    const newTransport = { send: secondCore.acceptedDeliveryReceipt }
    secondCore.setObservabilityTransport(newTransport)

    restoreOld()

    expect(secondCore.currentObservabilityTransport()).toBe(newTransport)
  }, 15_000)

  it('rejects a malformed registry at the exact versioned global key', async () => {
    const key = Symbol.for('@use-crux/core/process-registry/v1')
    const original = Reflect.get(globalThis, key)
    try {
      Reflect.set(globalThis, key, {
        packageName: '@use-crux/core',
        registryVersion: 1,
        runtime: {
          currentHooks: {},
          nextHooksLayerId: 1,
          hooksLayers: {},
          activeInstallation: undefined,
        },
        observability: {},
      })
      vi.resetModules()

      await expect(import('../src/index')).rejects.toThrow(
        'Incompatible @use-crux/core process registry found at the v1 global symbol',
      )
    } finally {
      Reflect.set(globalThis, key, original)
      vi.resetModules()
    }
  }, 15_000)

  it('rejects malformed listener entries in an otherwise compatible registry', async () => {
    const key = Symbol.for('@use-crux/core/process-registry/v1')
    const original = Reflect.get(globalThis, key)
    try {
      const registry = original as {
        runtime: object
        observability: object
      }
      Reflect.set(globalThis, key, {
        ...registry,
        runtime: { ...registry.runtime },
        observability: {
          ...registry.observability,
          listeners: new Set([{}]),
        },
      })
      vi.resetModules()

      await expect(import('../src/index')).rejects.toThrow(
        'Incompatible @use-crux/core process registry found at the v1 global symbol',
      )
    } finally {
      Reflect.set(globalThis, key, original)
      vi.resetModules()
    }
  }, 15_000)

  it('removes bad listeners without blocking valid cross-copy synchronization', async () => {
    const {
      addObservabilityRegistryListener,
      getCruxProcessRegistry,
      notifyObservabilityRegistryListeners,
    } = await import('../src/runtime/process-registry')
    const registry = getCruxProcessRegistry().observability
    const originalListeners = new Set(registry.listeners)
    const malformed = {} as WeakRef<() => void>
    const dead = { deref: () => undefined } as WeakRef<() => void>
    const throwing = () => {
      throw new Error('stale listener')
    }
    const valid = vi.fn()

    try {
      registry.listeners.clear()
      registry.listeners.add(malformed)
      registry.listeners.add(dead)
      addObservabilityRegistryListener(registry, throwing)
      addObservabilityRegistryListener(registry, valid)

      expect(() => notifyObservabilityRegistryListeners(registry)).not.toThrow()
      expect(valid).toHaveBeenCalledOnce()
      expect(registry.listeners.has(malformed)).toBe(false)
      expect(registry.listeners.has(dead)).toBe(false)
      expect(registry.listeners.size).toBe(1)
    } finally {
      registry.listeners.clear()
      for (const listener of originalListeners) registry.listeners.add(listener)
    }
  })
})
