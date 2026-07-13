import { afterEach, describe, expect, it } from 'vitest'
import type { HostBoundRuntimeEngineDefinition } from '../../src/runtime/api/runtime-definition'
import {
  createRuntimeWithHostContext,
  remainingHostDeadlineMs,
  runWithRuntimeHost,
  setRuntimeHostAsyncLocalStorageResolverForTesting,
} from '../../src/runtime/api/host-context'
import {
  getExecutionContext,
  runWithExecutionContext,
} from '../../src/runtime/execution-context'
import { observe, resetObservabilityRuntime } from '../../src/observability'

class SynchronousTestStorage<T> {
  private value: T | undefined

  getStore(): T | undefined {
    return this.value
  }

  run<R>(value: T, fn: () => R): R {
    const previous = this.value
    this.value = value
    try {
      return fn()
    } finally {
      this.value = previous
    }
  }
}

describe('runtime host context fallback', () => {
  afterEach(() => {
    setRuntimeHostAsyncLocalStorageResolverForTesting(undefined)
    resetObservabilityRuntime()
  })

  it('rejects async fallback scopes without leaking host context after an async boundary', async () => {
    setRuntimeHostAsyncLocalStorageResolverForTesting(() => undefined)
    const runtime = {
      kind: 'host-bound',
      id: 'test-host',
      host: 'test-host',
      capabilities: {},
      entry: 'testHost.run()',
    } as HostBoundRuntimeEngineDefinition
    let leaked = false
    let lateError: unknown

    const result = runWithRuntimeHost(
      {
        host: 'test-host',
        bind: () => {
          leaked = true
          throw new Error('host context leaked across async fallback boundary')
        },
      },
      async () => {
        await Promise.resolve()
        try {
          createRuntimeWithHostContext({ runtime, startMaintenance: false })
        } catch (error) {
          lateError = error
        }
      },
    )

    await expect(result).rejects.toThrow(/synchronous-only/)
    await Promise.resolve()
    expect(leaked).toBe(false)
    expect(lateError).toEqual(expect.objectContaining({ code: 'RUNTIME_HOST_ONLY' }))
  })

  it('shares one cold/warm storage resolver and retains synchronous execution metadata without ALS', () => {
    let resolverCalls = 0
    setRuntimeHostAsyncLocalStorageResolverForTesting(() => {
      resolverCalls += 1
      return SynchronousTestStorage
    })

    expect(
      runWithExecutionContext({ sessionId: 'sync-session' }, () => getExecutionContext()?.sessionId),
    ).toBe('sync-session')
    expect(getExecutionContext()).toBeUndefined()

    runWithRuntimeHost({ host: 'first', bind: () => ({}) as never }, () => undefined)
    runWithRuntimeHost({ host: 'second', bind: () => ({}) as never }, () => undefined)
    const run = observe.openRun({ name: 'shared storage', rootPrimitive: 'custom.operation' })
    run.withContext(() => observe.openSpan({ name: 'child', primitive: 'custom.operation' }).end())
    run.end()

    expect(resolverCalls).toBe(1)
  })

  it('falls back safely when storage resolution throws', () => {
    setRuntimeHostAsyncLocalStorageResolverForTesting(() => {
      throw new Error('host storage unavailable')
    })

    expect(
      runWithExecutionContext({ sessionId: 'fallback-session' }, () => getExecutionContext()?.sessionId),
    ).toBe('fallback-session')
  })

  it('keeps concurrent async host bindings isolated when ambient storage is available', async () => {
    const runtime = {
      kind: 'host-bound',
      id: 'test-host',
      host: 'test-host',
      capabilities: {},
      entry: 'testHost.run()',
    } as HostBoundRuntimeEngineDefinition
    const resolvedHosts: string[] = []

    await Promise.all(
      ['first', 'second'].map((host) =>
        runWithRuntimeHost(
          {
            host: 'test-host',
            bind: () => {
              resolvedHosts.push(host)
              return {} as never
            },
          },
          async () => {
            await Promise.resolve()
            createRuntimeWithHostContext({ runtime, startMaintenance: false })
          },
        ),
      ),
    )

    expect(resolvedHosts.sort()).toEqual(['first', 'second'])
  })
})

describe('host lifecycle deadline', () => {
  it('derives a bounded drain budget from an absolute host deadline', () => {
    expect(
      remainingHostDeadlineMs(
        { deadline: () => 1_250 },
        { now: () => 1_000, safetyMarginMs: 50 },
      ),
    ).toBe(200)
    expect(
      remainingHostDeadlineMs(
        { deadline: () => 1_020 },
        { now: () => 1_000, safetyMarginMs: 50 },
      ),
    ).toBe(0)
    expect(remainingHostDeadlineMs(undefined, { now: () => 1_000 })).toBeUndefined()
  })
})
