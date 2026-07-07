import {
  CruxRuntimeError,
  encodeWakeEnvelope,
  durableTask,
  type LeaseToken,
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
    const embedDocument = durableTask('embed-document', {
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
    const first = durableTask('embed-document', { run: async () => undefined })
    const second = durableTask('embed-document', { run: async () => undefined })

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

  it('does not start a lease heartbeat inside inline Convex wake handlers', async () => {
    const refs = {
      state: {
        hasIdempotencyKey: { op: 'state.hasIdempotencyKey' },
        getWork: { op: 'state.getWork' },
        putWork: { op: 'state.putWork' },
      },
      leases: {
        claim: { op: 'leases.claim' },
        extend: { op: 'leases.extend' },
        release: { op: 'leases.release' },
      },
      composites: {
        run: { op: 'composites.run' },
      },
    }
    const embedDocument = durableTask('embed-document-heartbeat', {
      run: async () => undefined,
    })
    const handlers = createConvexRuntimeHandlers({
      component: {
        runtime: {
          ...component.runtime,
          state: refs.state,
          leases: refs.leases,
          composites: refs.composites,
        },
      },
      targets: [embedDocument],
    })
    const work = {
      workId: 'work_heartbeat_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run' as const,
        taskId: 'task_1',
        targetId: embedDocument.targetId,
      },
      targetId: embedDocument.targetId,
      status: 'pending',
      attempt: 1,
      maxAttempts: 8,
      idempotencyKey: 'task:work_heartbeat_1',
      createdAt: new Date('2026-07-07T12:00:00.000Z'),
      updatedAt: new Date('2026-07-07T12:00:00.000Z'),
    }
    const lease = {
      resource: 'work:work_heartbeat_1',
      token: 'lease_heartbeat_1' as LeaseToken,
      expiresAt: new Date('2026-07-07T12:01:00.000Z'),
    }
    const calls: Array<{ readonly ref: unknown; readonly args: Record<string, unknown> }> = []
    const ctx = {
      scheduler: { runAfter: vi.fn(async () => undefined) },
      runQuery: vi.fn(async () => undefined),
      runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        calls.push({ ref, args })
        if (ref === refs.state.hasIdempotencyKey) return false
        if (ref === refs.state.getWork) return work
        if (ref === refs.state.putWork) return null
        if (ref === refs.leases.claim) return lease
        if (ref === refs.leases.extend) {
          throw new Error('Convex inline handlers must not extend leases.')
        }
        if (ref === refs.leases.release) return null
        if (ref === refs.composites.run) return null
        return null
      }),
    }
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => {
        throw new Error('setInterval unavailable in Convex isolate')
      })
    const envelope: WakeEnvelope = {
      v: 1,
      ns: 'tenant-a',
      workId: work.workId,
      target: embedDocument.targetId,
      kind: 'task.run',
      idempotencyKey: work.idempotencyKey,
      attempt: 1,
    }

    try {
      await expect(
        handlers.handleWake._handler?.(ctx as never, {
          envelope: JSON.parse(encodeWakeEnvelope(envelope)),
        }),
      ).resolves.toEqual({ status: 200, outcome: 'processed' })
    } finally {
      setIntervalSpy.mockRestore()
    }

    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(calls.map((call) => call.ref)).not.toContain(refs.leases.extend)
  })

  it('creates a Node target executor action for generated target modules', () => {
    const embedDocument = durableTask('embed-document', {
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
