import type {
  ClaimDueTimersOptions,
  ClaimExpiredWaitersOptions,
  ClaimOutboxOptions,
  DurableEventPort,
  Lease,
  LeasePort,
  RuntimeOutboxPort,
  RuntimeOutboxItem,
  RuntimeStoreTransaction,
  RuntimeTimerStorePort,
  RuntimeWaiterStorePort,
} from '@use-crux/core/runtime'
import type { EventCursor } from '@use-crux/core/runtime'
import type { ConvexCtxPort } from '../store'
import {
  decodeEvent,
  decodeLease,
  decodeOutbox,
  decodeTimer,
  decodeWaiter,
  encodeEvent,
  encodeLease,
  encodeOutboxDate,
  encodeTimer,
  encodeWaiter,
  encodeWakeEnvelope,
} from './codec'
import { createConvexDeferredStore } from './deferred-store'
import { createConvexEvalHostAdmission } from './eval-host/admission'
import { createConvexRuntimeResultStore } from './results'
import { createConvexEffectStore } from './effects-store'
import { createConvexSessionStore } from './session-store'
import type { ConvexRuntimeStore, ConvexRuntimeStoreOptions } from './store-types'
import { cleanArgs, noop, requireNamespace } from './store-utils'
import { createConvexCompositeRunner } from './composite-runner'
import { createConvexStateStore } from './state-store'

export type { ConvexRuntimeComponent, ConvexRuntimeStore, ConvexRuntimeStoreOptions } from './store-types'

export function convexRuntimeStore<TCtx extends ConvexCtxPort>(
  options: ConvexRuntimeStoreOptions<TCtx>,
): ConvexRuntimeStore {
  const now = options.now ?? (() => new Date())
  const run = <TResult>(ref: unknown, args: Record<string, unknown>) =>
    options.ctx.runMutation<TResult>(ref, cleanArgs(args))
  const refs = options.component.runtime

  const state = createConvexStateStore({ refs: refs.state, run, now })

  const events: DurableEventPort = {
    append: async (event, eventOptions) =>
      decodeEvent(
        await run(refs.events.append, {
          event: encodeEvent(event),
          idempotencyKey: eventOptions?.idempotencyKey,
        }),
      ),
    read: async (query) => {
      const result = await run<{
        events: readonly unknown[]
        cursor?: string
        afterFound?: boolean
      }>(refs.events.read, { ...query })
      return {
        events: result.events.map(decodeEvent),
        cursor: result.cursor as EventCursor | undefined,
        ...(result.afterFound === undefined
          ? {}
          : { afterFound: result.afterFound }),
      }
    },
    prune: (query) =>
      run(refs.events.prune, {
        ...query,
        before: query.before.getTime(),
      }),
  }

  const waiters: RuntimeWaiterStorePort = {
    register: async (waiter) => decodeWaiter(await run(refs.waiters.register, { waiter: encodeWaiter(waiter) })),
    resolve: async (eventName, payload, read = {}) =>
      (
        await run<readonly unknown[]>(refs.waiters.resolve, {
          eventName,
          payload,
          namespace: requireNamespace(read.namespace, 'waiters.resolve'),
        })
      ).map(decodeWaiter),
    cancel: (waiterId) => run(refs.waiters.cancel, { waiterId }).then(noop),
    attachTimer: (waiterId, timerId) => run(refs.waiters.attachTimer, { waiterId, timerId }).then(noop),
    listByWork: async (workId) =>
      (await run<readonly unknown[]>(refs.waiters.listByWork, { workId })).map(decodeWaiter),
    claimExpired: async (query: ClaimExpiredWaitersOptions) =>
      (
        await run<readonly unknown[]>(refs.waiters.claimExpired, {
          ...query,
          namespace: requireNamespace(query.namespace, 'waiters.claimExpired'),
          now: query.now.getTime(),
        })
      ).map(decodeWaiter),
    transition: (waiterId, from, to) => run(refs.waiters.transition, { waiterId, from, to }),
    prune: (query) =>
      run(refs.waiters.prune, {
        ...query,
        before: query.before.getTime(),
      }),
  }

  const timers: RuntimeTimerStorePort = {
    put: async (timer) => decodeTimer(await run(refs.timers.put, { timer: encodeTimer(timer) })),
    get: async (timerId) => {
      const result = await run<unknown>(refs.timers.get, { timerId })
      return result ? decodeTimer(result) : null
    },
    claimDue: async (query: ClaimDueTimersOptions) =>
      (
        await run<readonly unknown[]>(refs.timers.claimDue, {
          ...query,
          namespace: requireNamespace(query.namespace, 'timers.claimDue'),
          now: query.now.getTime(),
        })
      ).map(decodeTimer),
    list: async (query) => (await run<readonly unknown[]>(refs.timers.list, { ...query })).map(decodeTimer),
    listByWork: async (workId) => (await run<readonly unknown[]>(refs.timers.listByWork, { workId })).map(decodeTimer),
    transition: (timerId, from, to) => run(refs.timers.transition, { timerId, from, to }),
    prune: (query) =>
      run(refs.timers.prune, {
        ...query,
        before: query.before.getTime(),
      }),
  }

  const outbox: RuntimeOutboxPort = {
    put: async (envelope, options) =>
      decodeOutbox(
        await run(refs.outbox.put, {
          envelope: encodeWakeEnvelope(envelope),
          nextAttemptAt: (options?.deliverAt ?? now()).getTime(),
        }),
      ),
    get: async (outboxId) => {
      const result = await run<unknown>(refs.outbox.get, { outboxId })
      return result ? decodeOutbox(result) : null
    },
    claimPending: async (query: ClaimOutboxOptions) =>
      (
        await run<readonly unknown[]>(refs.outbox.claimPending, {
          ...query,
          namespace: requireNamespace(query.namespace, 'outbox.claimPending'),
          now: query.now.getTime(),
        })
      ).map(decodeOutbox) as readonly RuntimeOutboxItem[],
    list: async (query) =>
      (await run<readonly unknown[]>(refs.outbox.list, { ...query })).map(decodeOutbox) as readonly RuntimeOutboxItem[],
    listByWork: async (workId, query = {}) =>
      (await run<readonly unknown[]>(refs.outbox.listByWork, cleanArgs({ workId, ...query }))).map(
        decodeOutbox,
      ) as readonly RuntimeOutboxItem[],
    confirm: (outboxId) => run(refs.outbox.confirm, { outboxId }).then(noop),
    retryLater: (outboxId, nextAttemptAt) =>
      run(refs.outbox.retryLater, {
        outboxId,
        nextAttemptAt: encodeOutboxDate(nextAttemptAt),
      }).then(noop),
    prune: (query) =>
      run(refs.outbox.prune, {
        ...query,
        before: query.before.getTime(),
      }),
  }

  const leases: LeasePort = {
    claim: (resource, lease) =>
      run<unknown>(refs.leases.claim, {
        ...lease,
        resource,
        now: now().getTime(),
      }).then(decodeLease),
    extend: async (lease: Lease, ttlMs) => {
      const result = await run<unknown>(refs.leases.extend, {
        lease: encodeLease(lease),
        ttlMs,
        now: now().getTime(),
      })
      const next = decodeLease(result)
      if (!next) throw new Error(`Runtime lease ${lease.resource} could not be extended.`)
      return next
    },
    release: (lease) => run(refs.leases.release, { lease: encodeLease(lease) }).then(noop),
  }

  const deferred = createConvexDeferredStore({
    run,
    ...(refs.deferred ? { refs: refs.deferred } : {}),
  })

  const effects = refs.composite_effects
    ? createConvexEffectStore({ refs: refs.composite_effects, run })
    : undefined

  const transaction: RuntimeStoreTransaction = {
    state,
    events,
    waiters,
    timers,
    outbox,
    deferred,
    ...(effects ? { effects } : {}),
    ...(refs.sessions?.run ? { sessions: createConvexSessionStore({ ref: refs.sessions.run, run }) } : {}),
  }
  return Object.freeze({
    id: 'convex',
    durability: 'durable' as const,
    ...transaction,
    leases,
    ...(refs.results
      ? {
          results: createConvexRuntimeResultStore({
            refs: refs.results,
            run,
            now,
          }),
        }
      : {}),
    ...(refs.evalHost?.admit
      ? {
          evalHost: createConvexEvalHostAdmission({
            ref: refs.evalHost.admit,
            run,
          }),
        }
      : {}),
    runComposite: createConvexCompositeRunner({ refs, run }),
    transact: <T>(fn: (tx: RuntimeStoreTransaction) => Promise<T>) => fn(transaction),
  })
}
