import {
  CruxRuntimeError,
  task,
} from '@use-crux/core/runtime'
import { describe, expect, it } from 'vitest'
import {
  createConvexRuntimeHandlers,
  type ConvexRuntimeComponent,
} from '../runtime'

const component = {
  runtime: {
    state: {},
    events: {},
    waiters: {},
    timers: {},
    outbox: {},
    leases: {},
  },
} satisfies ConvexRuntimeComponent

describe('createConvexRuntimeHandlers()', () => {
  it('creates operational internal handler names for generated Convex entries', () => {
    const embedDocument = task('embed-document', {
      run: async () => undefined,
    })

    const handlers = createConvexRuntimeHandlers({
      component,
      targets: [embedDocument],
    })

    expect(handlers.handleWake).toBeTruthy()
    expect(handlers.deliverSignal).toBeTruthy()
    expect(handlers.resumeFlow).toBeTruthy()
    expect(handlers.runTask).toBeTruthy()
    expect(handlers.fireTimer).toBeTruthy()
  })

  it('rejects duplicate durable target names', () => {
    const first = task('embed-document', { run: async () => undefined })
    const second = task('embed-document', { run: async () => undefined })

    expect(() =>
      createConvexRuntimeHandlers({
        component,
        targets: [first, second],
      }),
    ).toThrowError(CruxRuntimeError)
    expect(() =>
      createConvexRuntimeHandlers({
        component,
        targets: [first, second],
      }),
    ).toThrowError(/TARGET_DUPLICATE/)
  })

  it('rejects name-only targets that cannot be resolved', () => {
    expect(() =>
      createConvexRuntimeHandlers({
        component,
        targets: [{ name: 'missing-runtime-target' }],
      }),
    ).toThrowError(CruxRuntimeError)
    expect(() =>
      createConvexRuntimeHandlers({
        component,
        targets: [{ name: 'missing-runtime-target' }],
      }),
    ).toThrowError(/TARGET_NOT_FOUND/)
  })

  it('validates wake envelopes with the core runtime decoder', async () => {
    const handlers = createConvexRuntimeHandlers({
      component,
      targets: [],
    })

    await expect(
      handlers.handleWake._handler?.({} as never, {
        envelope: { v: 2, ns: 'tenant-a' },
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_NOT_JSON' })
  })
})
