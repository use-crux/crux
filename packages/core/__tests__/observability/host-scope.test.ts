import { afterEach, describe, expect, it } from 'vitest'
import { activeHostLifecycle, runWithHostLifecycle } from '../../src/observability/delivery/host-scope'
import {
  acceptedDeliveryReceipt,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

describe('runWithHostLifecycle / activeHostLifecycle', () => {
  it('is unbound outside of any scope', () => {
    expect(activeHostLifecycle()).toBeUndefined()
  })

  it('keeps two concurrent async scopes isolated from each other', async () => {
    const seen: Array<{ id: string; deadline: number | undefined }> = []

    const run = async (id: string, deadline: number, delayMs: number) =>
      runWithHostLifecycle({ deadline: () => deadline }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        seen.push({ id, deadline: activeHostLifecycle()?.deadline?.() })
      })

    await Promise.all([run('fast', 1_000, 5), run('slow', 2_000, 20)])

    expect(seen).toEqual(
      expect.arrayContaining([
        { id: 'fast', deadline: 1_000 },
        { id: 'slow', deadline: 2_000 },
      ]),
    )
  })

  it('restores the outer scope after a nested scope exits', () => {
    runWithHostLifecycle({ deadline: () => 1 }, () => {
      runWithHostLifecycle({ deadline: () => 2 }, () => {
        expect(activeHostLifecycle()?.deadline?.()).toBe(2)
      })
      expect(activeHostLifecycle()?.deadline?.()).toBe(1)
    })
    expect(activeHostLifecycle()).toBeUndefined()
  })
})

describe('observe.withHostLifecycle', () => {
  afterEach(() => resetObservabilityRuntime())

  it('bounds flush() by the scoped deadline without an explicit timeoutMs', async () => {
    setObservabilityTransport(
      { send: () => new Promise(() => undefined) },
      { scheduledDelayMs: 0 },
    )

    await observe.withHostLifecycle({ deadline: () => Date.now() + 5 }, async () => {
      observe.openRun({ name: 'bounded by scope', rootPrimitive: 'custom.operation' }).end()
      await expect(observe.flush()).resolves.toMatchObject({ status: 'deadline' })
    })
  })

  it('does not leave a scoped deadline active for flush calls made outside any scope', async () => {
    setObservabilityTransport(
      { send: (records) => Promise.resolve(acceptedDeliveryReceipt(records)) },
      { scheduledDelayMs: 0 },
    )

    await observe.withHostLifecycle({ deadline: () => Date.now() + 5 }, () => {
      observe.openRun({ name: 'inside a short scope', rootPrimitive: 'custom.operation' }).end()
    })

    observe.openRun({ name: 'outside any scope', rootPrimitive: 'custom.operation' }).end()
    await expect(observe.flush()).resolves.toMatchObject({ status: 'drained' })
    expect(observabilityDiagnostics().queuedRecords).toBe(0)
  })

  it('attaches send tasks created within the scope to that scope\'s defer capability', async () => {
    const deferredA: Promise<void>[] = []
    const deferredB: Promise<void>[] = []
    setObservabilityTransport({
      send: (records) => Promise.resolve(acceptedDeliveryReceipt(records)),
    })

    await observe.withHostLifecycle({ defer: (task) => deferredA.push(task) }, async () => {
      observe.openRun({ name: 'scope a', rootPrimitive: 'custom.operation' }).end()
      await observe.flush()
    })
    await observe.withHostLifecycle({ defer: (task) => deferredB.push(task) }, async () => {
      observe.openRun({ name: 'scope b', rootPrimitive: 'custom.operation' }).end()
      await observe.flush()
    })

    expect(deferredA.length).toBeGreaterThan(0)
    expect(deferredB.length).toBeGreaterThan(0)
    expect(observabilityDiagnostics().queuedRecords).toBe(0)
  })
})
