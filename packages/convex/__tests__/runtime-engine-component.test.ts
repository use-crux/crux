import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, it } from 'vitest'
import schema from '../src/component/schema'

type MutationArgs = Record<string, unknown>

const modules = {
  '../src/component/_generated/server.ts': () => import('../src/component/_generated/server'),
  '../src/component/runtime/events.ts': () => import('../src/component/runtime/events'),
  '../src/component/runtime/leases.ts': () => import('../src/component/runtime/leases'),
  '../src/component/runtime/outbox.ts': () => import('../src/component/runtime/outbox'),
  '../src/component/runtime/state.ts': () => import('../src/component/runtime/state'),
  '../src/component/runtime/timers.ts': () => import('../src/component/runtime/timers'),
  '../src/component/runtime/waiters.ts': () => import('../src/component/runtime/waiters'),
} satisfies Record<string, () => Promise<unknown>>

const appendEvent = mutation<
  {
    event: {
      namespace: string
      name: string
      payload: unknown
      eventId?: string
    }
    idempotencyKey?: string
  },
  { eventId: string; payload: unknown }
>('runtime/events:append')

const readEvents = mutation<
  { namespace: string; after?: string; limit?: number },
  { events: Array<{ eventId: string; name: string }>; cursor?: string }
>('runtime/events:read')

const registerWaiter = mutation<
  { waiter: Record<string, unknown> },
  { waiterId: string; state: string }
>('runtime/waiters:register')
const resolveWaiters = mutation<
  { eventName: string; payload: unknown; namespace?: string },
  Array<{ waiterId: string; state: string }>
>('runtime/waiters:resolve')
const claimExpiredWaiters = mutation<
  { namespace?: string; now: number; limit?: number },
  Array<{ waiterId: string; state: string }>
>('runtime/waiters:claimExpired')
const transitionWaiter = mutation<
  { waiterId: string; from: string; to: string },
  boolean
>('runtime/waiters:transition')

const putTimer = mutation<
  { timer: Record<string, unknown> },
  { timerId: string; state: string }
>('runtime/timers:put')
const claimDueTimers = mutation<
  { namespace?: string; now: number; limit?: number },
  Array<{ timerId: string; state: string }>
>('runtime/timers:claimDue')
const listTimers = mutation<
  { namespace: string; state?: string; limit?: number },
  Array<{ timerId: string; state: string }>
>('runtime/timers:list')
const transitionTimer = mutation<
  { timerId: string; from: string; to: string },
  boolean
>('runtime/timers:transition')

const putOutbox = mutation<
  { envelope: { ns: string; workId: string }; nextAttemptAt: number },
  { outboxId: string; state: string }
>('runtime/outbox:put')
const claimOutbox = mutation<
  { namespace?: string; now: number; limit?: number },
  Array<{ outboxId: string; state: string; attempts: number }>
>('runtime/outbox:claimPending')
const listOutbox = mutation<
  { namespace: string; state?: string; limit?: number },
  Array<{ outboxId: string; state: string }>
>('runtime/outbox:list')
const confirmOutbox = mutation<{ outboxId: string }, null>('runtime/outbox:confirm')

const createWork = mutation<{ work: Record<string, unknown> }, Record<string, unknown>>(
  'runtime/state:createWork',
)
const listWork = mutation<
  { namespace: string; status: string; updatedBefore?: number; limit?: number },
  Array<Record<string, unknown>>
>('runtime/state:listWork')
const setWorkPending = mutation<
  {
    workId: string
    namespace: string
    work: Record<string, unknown>
    idempotencyKey: string
    now: number
    from?: string | string[]
  },
  Record<string, unknown> | null
>('runtime/state:setWorkPending')
const getWork = mutation<
  { workId: string; namespace: string },
  Record<string, unknown> | null
>('runtime/state:getWork')
const countWork = mutation<
  { namespace: string },
  Array<{ namespace: string; status: string; targetId: string; count: number; truncated?: boolean }>
>('runtime/state:countWork')

describe('Crux Convex Runtime Engine component', () => {
  it('deduplicates durable events by event id and idempotency key', async () => {
    const t = convexTest({ schema, modules })

    const first = await t.mutation(appendEvent, {
      event: {
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { value: 1 },
        eventId: 'evt-custom',
      },
    })
    const duplicateByEventId = await t.mutation(appendEvent, {
      event: {
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { value: 2 },
        eventId: 'evt-custom',
      },
    })

    expect(first).toMatchObject({ eventId: 'evt-custom', payload: { value: 1 } })
    expect(duplicateByEventId).toEqual(first)

    const firstByKey = await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'document.ready', payload: { value: 3 } },
      idempotencyKey: 'signal:doc-1',
    })
    const duplicateByKey = await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'document.ready', payload: { value: 4 } },
      idempotencyKey: 'signal:doc-1',
    })

    expect(duplicateByKey).toEqual(firstByKey)
  })

  it('does not treat caller event ids as internal cursors during duplicate lookup', async () => {
    const t = convexTest({ schema, modules })

    const generated = await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'generated', payload: { value: 1 } },
    })
    const callerSupplied = await t.mutation(appendEvent, {
      event: {
        namespace: 'tenant-a',
        name: 'caller-supplied',
        payload: { value: 2 },
        eventId: generated.eventId,
      },
    })

    expect(callerSupplied).toMatchObject({
      eventId: generated.eventId,
      name: 'caller-supplied',
      payload: { value: 2 },
    })
    await expect(
      t.run(async (ctx) => await ctx.db.query('runtimeEvents').collect()),
    ).resolves.toHaveLength(2)
  })

  it('reads after caller-provided event cursors in stable append order', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'first', payload: {}, eventId: 'evt-first' },
    })
    const second = await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'second', payload: {} },
    })

    await expect(t.mutation(readEvents, { namespace: 'tenant-a', after: 'evt-first' })).resolves.toEqual({
      events: [expect.objectContaining({ eventId: second.eventId, name: 'second' })],
      cursor: second.eventId,
      afterFound: true,
    })
  })

  it('appends runtime events without a shared namespace counter table', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'first', payload: {} },
    })
    await t.mutation(appendEvent, {
      event: { namespace: 'tenant-a', name: 'second', payload: {} },
    })

    await expect(
      t.run(async (ctx) => await ctx.db.query('runtimeEvents').collect()),
    ).resolves.toHaveLength(2)
  })

  it('rejects namespace-less maintenance scans instead of collecting whole tables', async () => {
    const t = convexTest({ schema, modules })

    await expect(
      t.mutation(resolveWaiters, {
        eventName: 'document.approved',
        payload: { documentId: 'doc-1' },
      }),
    ).rejects.toThrow('namespace')
    await expect(t.mutation(claimExpiredWaiters, { now: 10 })).rejects.toThrow('namespace')
    await expect(t.mutation(claimDueTimers, { now: 10 })).rejects.toThrow('namespace')
    await expect(t.mutation(claimOutbox, { now: 10 })).rejects.toThrow('namespace')
  })

  it('only resolves and claims active waiter, timer, and outbox rows', async () => {
    const t = convexTest({ schema, modules })

    const waiter = await t.mutation(registerWaiter, {
      waiter: {
        namespace: 'tenant-a',
        eventName: 'document.approved',
        match: { documentId: 'doc-1' },
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        timeoutAt: 10,
      },
    })
    await expect(
      t.mutation(resolveWaiters, {
        eventName: 'document.approved',
        payload: { documentId: 'doc-1' },
        namespace: 'tenant-a',
      }),
    ).resolves.toHaveLength(1)
    await expect(
      t.mutation(transitionWaiter, { waiterId: waiter.waiterId, from: 'armed', to: 'fired' }),
    ).resolves.toBe(true)
    await expect(
      t.mutation(resolveWaiters, {
        eventName: 'document.approved',
        payload: { documentId: 'doc-1' },
        namespace: 'tenant-a',
      }),
    ).resolves.toEqual([])
    await expect(t.mutation(claimExpiredWaiters, { namespace: 'tenant-a', now: 10 })).resolves.toEqual([])

    const timer = await t.mutation(putTimer, {
      timer: {
        namespace: 'tenant-a',
        fireAt: 10,
        work: { kind: 'flow.timeout', flowId: 'flow-1', suspendPoint: 'approval' },
      },
    })
    await expect(
      t.mutation(transitionTimer, { timerId: timer.timerId, from: 'scheduled', to: 'cancelled' }),
    ).resolves.toBe(true)
    await expect(t.mutation(claimDueTimers, { namespace: 'tenant-a', now: 10 })).resolves.toEqual([])

    const outbox = await t.mutation(putOutbox, {
      envelope: { ns: 'tenant-a', workId: 'work-1' },
      nextAttemptAt: 10,
    })
    await t.mutation(confirmOutbox, { outboxId: outbox.outboxId })
    await expect(t.mutation(claimOutbox, { namespace: 'tenant-a', now: 10 })).resolves.toEqual([])
    await expect(t.mutation(listOutbox, { namespace: 'tenant-a' })).resolves.toEqual([
      expect.objectContaining({ outboxId: outbox.outboxId, state: 'confirmed' }),
    ])
  })

  it('deduplicates pending outbox rows but allows re-enqueue after dispatch', async () => {
    const t = convexTest({ schema, modules })
    const envelope = {
      ns: 'tenant-a',
      workId: 'work-1',
      target: 'review',
      kind: 'task.run',
      idempotencyKey: 'task:work-1',
      attempt: 1,
    }

    const first = await t.mutation(putOutbox, { envelope, nextAttemptAt: 10 })
    await expect(t.mutation(putOutbox, { envelope, nextAttemptAt: 10 })).resolves.toMatchObject({
      outboxId: first.outboxId,
    })

    await expect(t.mutation(claimOutbox, { namespace: 'tenant-a', now: 10, limit: 1 })).resolves.toEqual([
      expect.objectContaining({ outboxId: first.outboxId, state: 'dispatched' }),
    ])
    const second = await t.mutation(putOutbox, { envelope, nextAttemptAt: 10 })
    expect(second.outboxId).not.toBe(first.outboxId)
    await t.mutation(confirmOutbox, { outboxId: first.outboxId })

    await expect(t.mutation(claimOutbox, { namespace: 'tenant-a', now: 10, limit: 2 })).resolves.toEqual([
      expect.objectContaining({ outboxId: second.outboxId, state: 'dispatched' }),
    ])
  })

  it('matches array waiter payloads only when no top-level object keys are required', async () => {
    const t = convexTest({ schema, modules })

    await t.mutation(registerWaiter, {
      waiter: {
        namespace: 'tenant-a',
        eventName: 'document.batch',
        match: { length: 2 },
        work: { kind: 'flow.resume', flowId: 'flow-1' },
      },
    })
    await expect(
      t.mutation(resolveWaiters, {
        eventName: 'document.batch',
        payload: ['doc-1', 'doc-2'],
        namespace: 'tenant-a',
      }),
    ).resolves.toEqual([])

    await t.mutation(registerWaiter, {
      waiter: {
        namespace: 'tenant-a',
        eventName: 'document.any-batch',
        match: {},
        work: { kind: 'flow.resume', flowId: 'flow-1' },
      },
    })
    await expect(
      t.mutation(resolveWaiters, {
        eventName: 'document.any-batch',
        payload: ['doc-1', 'doc-2'],
        namespace: 'tenant-a',
      }),
    ).resolves.toHaveLength(1)
  })

  it('lists timers through namespace/state indexes when no state filter is supplied', async () => {
    const t = convexTest({ schema, modules })
    const timer = await t.mutation(putTimer, {
      timer: {
        namespace: 'tenant-a',
        fireAt: 10,
        work: { kind: 'flow.timeout', flowId: 'flow-1', suspendPoint: 'approval' },
      },
    })
    await t.mutation(putTimer, {
      timer: {
        namespace: 'tenant-b',
        fireAt: 10,
        work: { kind: 'flow.timeout', flowId: 'flow-2', suspendPoint: 'approval' },
      },
    })

    await expect(t.mutation(listTimers, { namespace: 'tenant-a' })).resolves.toEqual([
      expect.objectContaining({ timerId: timer.timerId, state: 'scheduled' }),
    ])
  })

  it('replaces work rows when moving suspended work back to pending', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(createWork, {
      work: {
        workId: 'work-1',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        targetId: 'review',
        status: 'suspended',
        attempt: 2,
        maxAttempts: 8,
        notBefore: 10,
        idempotencyKey: 'resume:old',
        leaseToken: 'lease-old',
        lastError: { code: 'ERR', message: 'failed', at: 10 },
        createdAt: 1,
        updatedAt: 2,
      },
    })

    await expect(
      t.mutation(setWorkPending, {
        workId: 'work-1',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        idempotencyKey: 'resume:new',
        now: 20,
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'resume:new',
      updatedAt: 20,
    })

    const work = await t.mutation(getWork, { workId: 'work-1', namespace: 'tenant-a' })
    expect(work).not.toHaveProperty('notBefore')
    expect(work).not.toHaveProperty('leaseToken')
    expect(work).not.toHaveProperty('lastError')
  })

  it('honors explicit setWorkPending source statuses', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(createWork, {
      work: {
        workId: 'work-blocked',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        targetId: 'review',
        status: 'blocked',
        attempt: 8,
        maxAttempts: 8,
        idempotencyKey: 'resume:old',
        lastError: { code: 'ERR', message: 'failed', at: 10 },
        createdAt: 1,
        updatedAt: 2,
      },
    })

    await expect(
      t.mutation(setWorkPending, {
        workId: 'work-blocked',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        idempotencyKey: 'retry:new',
        now: 20,
      }),
    ).resolves.toBeNull()
    await expect(
      t.mutation(setWorkPending, {
        workId: 'work-blocked',
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow-1' },
        idempotencyKey: 'retry:new',
        now: 20,
        from: 'blocked',
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'retry:new',
    })
  })

  it('counts work rows by namespace, status, and target id', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(createWork, {
      work: workRow('work-1', 'tenant-a', 'pending', 'review'),
    })
    await t.mutation(createWork, {
      work: workRow('work-2', 'tenant-a', 'pending', 'review'),
    })
    await t.mutation(createWork, {
      work: workRow('work-3', 'tenant-a', 'leased', 'review'),
    })
    await t.mutation(createWork, {
      work: workRow('work-4', 'tenant-b', 'pending', 'review'),
    })

    await expect(t.mutation(countWork, { namespace: 'tenant-a' })).resolves.toEqual([
      { namespace: 'tenant-a', status: 'pending', targetId: 'review', count: 2 },
      { namespace: 'tenant-a', status: 'leased', targetId: 'review', count: 1 },
    ])
  })

  it('lists bounded work rows by status', async () => {
    const t = convexTest({ schema, modules })
    await t.mutation(createWork, {
      work: workRow('work-1', 'tenant-a', 'pending', 'review'),
    })
    await t.mutation(createWork, {
      work: workRow('work-2', 'tenant-a', 'pending', 'review'),
    })
    await t.mutation(createWork, {
      work: workRow('work-3', 'tenant-a', 'pending', 'review'),
    })

    await expect(
      t.mutation(listWork, { namespace: 'tenant-a', status: 'pending', limit: 2 }),
    ).resolves.toHaveLength(2)
  })
})

function mutation<TArgs extends MutationArgs, TResult>(path: string) {
  return makeFunctionReference<'mutation', TArgs, TResult>(path)
}

function workRow(workId: string, namespace: string, status: string, targetId: string) {
  return {
    workId,
    namespace,
    work: { kind: 'flow.resume', flowId: `${workId}-flow` },
    targetId,
    status,
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: `${status}:${workId}`,
    createdAt: 1,
    updatedAt: 1,
  }
}
