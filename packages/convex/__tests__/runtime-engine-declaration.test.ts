import { config } from '@use-crux/core'
import {
  CruxRuntimeError,
  createRuntime,
} from '@use-crux/core/runtime'
import { describe, expect, it } from 'vitest'
import { CONVEX_RUNTIME_ENTRY, convex } from '../src/runtime'

describe('convex() Runtime Engine declaration', () => {
  it('declares a host-bound runtime accepted by core config', () => {
    const runtime = convex({ namespace: 'tenant-a' })
    const crux = config({ runtime })

    expect(crux.config.runtime).toMatchObject({
      kind: 'host-bound',
      id: 'convex',
      host: 'convex',
      namespace: 'tenant-a',
      entry: CONVEX_RUNTIME_ENTRY,
    })
    expect(runtime.capabilities).toMatchObject({
      events: { durable: true, cursorReads: true },
      waiters: { durable: true },
      wake: { atLeastOnce: true },
    })

    crux.dispose()
  })

  it('throws RUNTIME_HOST_ONLY when executed outside Convex handlers', () => {
    const runtime = convex()

    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(CruxRuntimeError)
    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(/RUNTIME_HOST_ONLY/)
    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(/createConvexRuntimeHandlers/)
  })
})
