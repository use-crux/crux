import { describe, expect, it } from 'vitest'
import { createRuntimeKernel } from '@use-crux/core/runtime'
import type {
  FlowId,
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  WorkId,
} from '@use-crux/core/runtime'
import type { ConvexCtxPort } from '../src/store'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../src/runtime'
import { encodeCompositeValue } from '../src/runtime-engine/codec'

const component = {
  runtime: {
    state: {},
    events: {},
    waiters: { register: {} },
    timers: {},
    outbox: {},
    leases: {},
  },
} satisfies ConvexRuntimeComponent

describe('convexRuntimeStore()', () => {
  it('encodes waiter timeout Dates before crossing the Convex component boundary', async () => {
    const calls: Array<{ readonly args: Record<string, unknown> }> = []
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(_ref: unknown, args: Record<string, unknown>) => {
        calls.push({ args })
        const waiter = args.waiter as Record<string, unknown>
        return { ...waiter, waiterId: 'waiter_1', state: 'armed' } as TResult
      },
    }

    const store = convexRuntimeStore({ ctx, component })
    const waiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.approved',
      match: { documentId: 'doc-1' },
      work: { kind: 'flow.resume', flowId: 'flow-1' as FlowId },
      timeoutAt: new Date(123),
    })

    expect((calls[0]!.args.waiter as Record<string, unknown>).timeoutAt).toBe(123)
    expect(waiter.timeoutAt).toEqual(new Date(123))
  })

  it('routes kernel composites through one component mutation', async () => {
    const calls: Array<{ readonly ref: unknown; readonly args: Record<string, unknown> }> = []
    const componentRef = {}
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) => {
        calls.push({ ref, args })
        return encodeCompositeValue({
          workId: 'work_task_1',
          namespace: 'tenant-a',
          work: {
            kind: 'task.run',
            taskId: 'task_1',
            targetId: 'embed-document',
          },
          targetId: 'embed-document',
          status: 'pending',
          attempt: 1,
          maxAttempts: 8,
          idempotencyKey: 'task:work_task_1',
          createdAt: new Date('2026-07-06T12:00:00.000Z'),
          updatedAt: new Date('2026-07-06T12:00:00.000Z'),
        }) as TResult
      },
    }
    const store = convexRuntimeStore({
      ctx,
      component: {
        ...component,
        runtime: {
          ...component.runtime,
          composites: { run: componentRef },
        },
      },
    })
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'work_task_1' as WorkId,
    })

    const work = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })

    expect(work.createdAt).toEqual(new Date('2026-07-06T12:00:00.000Z'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      ref: componentRef,
      args: { kind: 'task.enqueue' },
    })
  })

  it('collapses the wake completion commit into one component mutation', async () => {
    const refs = {
      state: {
        hasIdempotencyKey: { op: 'state.hasIdempotencyKey' },
        getWork: { op: 'state.getWork' },
        putWork: { op: 'state.putWork' },
      },
      leases: {
        claim: { op: 'leases.claim' },
        release: { op: 'leases.release' },
      },
      composites: {
        run: { op: 'composites.run' },
      },
    }
    const calls: Array<{
      readonly ref: unknown
      readonly args: Record<string, unknown>
    }> = []
    const work = {
      workId: 'work_wake_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run' as const,
        taskId: 'task_1' as TaskId,
        targetId: 'review' as RuntimeTargetId,
      },
      targetId: 'review' as RuntimeTargetId,
      status: 'pending',
      attempt: 1,
      maxAttempts: 8,
      idempotencyKey: 'task:work_wake_1',
      createdAt: new Date('2026-07-06T12:00:00.000Z'),
      updatedAt: new Date('2026-07-06T12:00:00.000Z'),
    }
    const lease = {
      resource: 'work:work_wake_1',
      token: 'lease_1' as LeaseToken,
      expiresAt: new Date('2026-07-06T12:01:00.000Z'),
    }
    const ctx: ConvexCtxPort = {
      runQuery: async <TResult>() => undefined as TResult,
      runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) => {
        calls.push({ ref, args })
        if (ref === refs.state.hasIdempotencyKey) return false as TResult
        if (ref === refs.state.getWork) return work as TResult
        if (ref === refs.leases.claim) return lease as TResult
        if (ref === refs.composites.run) return undefined as TResult
        return null as TResult
      },
    }
    const store = convexRuntimeStore({
      ctx,
      component: {
        runtime: {
          ...component.runtime,
          state: refs.state,
          leases: refs.leases,
          composites: refs.composites,
        },
      },
    })
    const targetMarker = { op: 'target.execute' }
    const kernel = createRuntimeKernel({
      store,
      targets: {
        review: {
          targetId: 'review' as RuntimeTargetId,
          kind: 'task',
          execute: async () => {
            calls.push({ ref: targetMarker, args: {} })
            return { status: 'completed' }
          },
        },
      },
      leaseExtension: false,
      newWorkId: () => 'work_child_1' as WorkId,
      now: () => new Date('2026-07-06T12:00:00.000Z'),
    })

    await expect(
      kernel.handleWake({
        v: 1,
        ns: 'tenant-a',
        workId: 'work_wake_1' as WorkId,
        target: 'review' as RuntimeTargetId,
        kind: 'task.run',
        idempotencyKey: 'task:work_wake_1',
        attempt: 1,
      }),
    ).resolves.toEqual({ status: 200, outcome: 'processed' })

    const targetIndex = calls.findIndex((call) => call.ref === targetMarker)
    expect(calls.slice(targetIndex + 1).map((call) => call.ref)).toEqual([
      refs.composites.run,
      refs.leases.release,
    ])
    expect(
      calls.find((call) => call.ref === refs.composites.run),
    ).toMatchObject({
      args: { kind: 'wake.complete' },
    })
  })
})
