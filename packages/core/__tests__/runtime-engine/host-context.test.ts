import { afterEach, describe, expect, it } from 'vitest'
import type { HostBoundRuntimeEngineDefinition } from '../../runtime/api/runtime-definition'
import {
  createRuntimeWithHostContext,
  runWithRuntimeHost,
  setRuntimeHostAsyncLocalStorageResolverForTesting,
} from '../../runtime/api/host-context'

describe('runtime host context fallback', () => {
  afterEach(() => {
    setRuntimeHostAsyncLocalStorageResolverForTesting(undefined)
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
})
