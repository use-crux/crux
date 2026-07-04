import {
  CruxRuntimeError,
  encodeWakeEnvelope,
  task,
  type RuntimeTargetId,
  type WakeEnvelope,
  type WorkId,
} from '@use-crux/core/runtime'
import { makeFunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { describe, expect, it, vi } from 'vitest'
import { createConvexRuntimeHandlers, type ConvexRuntimeComponent } from '../runtime'
import { createConvexRuntimeTargetExecutor } from '../runtime-node'
import { flow } from '../server'

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

  it('schedules configured target executor actions from isolate-safe wake handlers', async () => {
    const targetExecutor = makeFunctionReference<'action', { envelope: unknown }, unknown>(
      '_crux/targets:executeTarget',
    )
    const handlers = createConvexRuntimeHandlers({
      component,
      targetExecutor,
    })
    const runAfter = vi.fn(async () => undefined)
    const envelope: WakeEnvelope = {
      v: 1,
      ns: 'tenant-a',
      workId: 'work_1' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'flow.resume',
      idempotencyKey: 'wake:work_1',
      attempt: 1,
    }

    await expect(
      handlers.handleWake._handler?.({ scheduler: { runAfter } } as never, {
        envelope: JSON.parse(encodeWakeEnvelope(envelope)),
      }),
    ).resolves.toEqual({ scheduled: true })

    expect(runAfter).toHaveBeenCalledWith(0, targetExecutor, {
      envelope,
    })
  })

  it('creates a Node target executor action for generated target modules', () => {
    const embedDocument = task('embed-document', {
      run: async () => undefined,
    })

    const executor = createConvexRuntimeTargetExecutor({
      component,
      targets: [embedDocument],
    })

    expect(executor.executeTarget).toBeTruthy()
  })

  it('accepts Convex server flow handles as generated Node target modules', () => {
    const reviewFlow = flow({
      name: 'convex-review',
      args: { docId: v.string() },
      handler: async () => undefined,
    })

    const executor = createConvexRuntimeTargetExecutor({
      component,
      targets: [reviewFlow],
    })

    expect(executor.executeTarget).toBeTruthy()
  })
})
