import { describe, expect, it } from 'vitest'
import type { FlowId } from '@use-crux/core/runtime'
import type { ConvexCtxPort } from '../store'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../runtime'

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
})
