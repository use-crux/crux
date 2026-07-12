import { createRuntimeError } from '@use-crux/core/runtime'
import type {
  ClaimDueTimersOptions,
  ClaimExpiredWaitersOptions,
  ClaimOutboxOptions,
  DurableEventPort,
  Lease,
  LeasePort,
  RuntimeOutboxPort,
  RuntimeOutboxItem,
  RuntimeCompositeInput,
  RuntimeCompositeKind,
  RuntimeCompositeResult,
  RuntimeStatePort,
  RuntimeStoreAdapter,
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
  decodeSnapshot,
  decodeTimer,
  decodeWaiter,
  decodeWork,
  encodeEvent,
  encodeIdempotency,
  encodeLease,
  encodeOutboxDate,
  encodeSnapshot,
  encodeTimer,
  encodeWaiter,
  encodeWakeEnvelope,
  decodeCompositeValue,
  encodeCompositeValue,
  encodeWork,
  encodeWorkForCreate,
} from './codec'
import { assertConvexDeferredComponent, createConvexDeferredStore } from './deferred-store'

/** Component refs needed by the Runtime Engine store adapter. */
export interface ConvexRuntimeComponent {
  readonly runtime: {
    readonly state: Record<string, unknown>
    readonly events: Record<string, unknown>
    readonly waiters: Record<string, unknown>
    readonly timers: Record<string, unknown>
    readonly outbox: Record<string, unknown>
    readonly leases: Record<string, unknown>
    readonly deferred?: Record<string, unknown>
    readonly composites?: {
      readonly run?: unknown
    }
  }
}

/** Configuration for {@link convexRuntimeStore}. */
export interface ConvexRuntimeStoreOptions<TCtx extends ConvexCtxPort = ConvexCtxPort> {
  /** Current Convex mutation ctx. */
  readonly ctx: TCtx
  /** Crux Convex component refs, normally `components.crux`. */
  readonly component: ConvexRuntimeComponent
  /** Clock used for deterministic tests. */
  readonly now?: () => Date
}

/** Create a Runtime Engine store backed by the Crux Convex component. */
export function convexRuntimeStore<TCtx extends ConvexCtxPort>(
  options: ConvexRuntimeStoreOptions<TCtx>,
): RuntimeStoreAdapter {
  const now = options.now ?? (() => new Date())
  const run = <TResult>(ref: unknown, args: Record<string, unknown>) =>
    options.ctx.runMutation<TResult>(ref, cleanArgs(args))
  // Keep store construction lazy for older generated component refs. Existing
  // Runtime operations fail at their own missing ref; named defer provides the
  // more specific version diagnostic when its port is first used.
  const refs = options.component.runtime ?? ({} as ConvexRuntimeComponent['runtime'])

  const state: RuntimeStatePort = {
    createWork: async (work) => decodeWork(await run(refs.state.createWork, { work: encodeWorkForCreate(work) })),
    getWork: async (workId, read) => {
      const result = await run<unknown>(refs.state.getWork, {
        workId,
        namespace: read.namespace,
      })
      return result ? decodeWork(result) : null
    },
    putWork: (work) => run(refs.state.putWork, { work: encodeWork(work) }).then(noop),
    listWork: async (query) =>
      (
        await run<readonly unknown[]>(refs.state.listWork, {
          ...query,
          updatedBefore: query.updatedBefore?.getTime(),
        })
      ).map(decodeWork),
    pruneTerminalWork: (query) =>
      run(refs.state.pruneTerminalWork, {
        ...query,
        before: query.before.getTime(),
      }),
    countWork: (query) => run(refs.state.countWork, { ...query }),
    setWorkPending: async (workId, pending) => {
      const result = await run<unknown>(refs.state.setWorkPending, {
        workId,
        namespace: pending.namespace,
        work: pending.work,
        idempotencyKey: pending.idempotencyKey,
        now: now().getTime(),
        from: pending.from,
      })
      return result ? decodeWork(result) : null
    },
    getSnapshot: async (flowId, read) => {
      const result = await run<unknown>(refs.state.getSnapshot, {
        flowId,
        namespace: read.namespace,
      })
      return result ? decodeSnapshot(result) : null
    },
    putSnapshot: (snapshot) => run(refs.state.putSnapshot, { snapshot: encodeSnapshot(snapshot) }).then(noop),
    pruneTerminalSnapshots: (query) =>
      run(refs.state.pruneTerminalSnapshots, {
        ...query,
        before: query.before.getTime(),
      }),
    markSnapshotDelivered: (workId, delivery) =>
      run(refs.state.markSnapshotDelivered, { workId, ...delivery }).then(noop),
    hasIdempotencyKey: (namespace, key) => run(refs.state.hasIdempotencyKey, { namespace, key }),
    putIdempotencyKey: (record) =>
      run(refs.state.putIdempotencyKey, {
        record: encodeIdempotency(record),
      }).then(noop),
    pruneIdempotencyKeys: (query) =>
      run(refs.state.pruneIdempotencyKeys, {
        ...query,
        before: query.before.getTime(),
      }),
    incrementIdle: (namespace, scope) => run(refs.state.incrementIdle, { namespace, scope }),
    decrementIdle: (namespace, scope) => run(refs.state.decrementIdle, { namespace, scope }),
    getIdleCount: (namespace, scope) => run(refs.state.getIdleCount, { namespace, scope }),
  }

  const events: DurableEventPort = {
    append: async (event, eventOptions) =>
      decodeEvent(
        await run(refs.events.append, {
          event: encodeEvent(event),
          idempotencyKey: eventOptions?.idempotencyKey,
        }),
      ),
    read: async (query) => {
      const result = await run<{ events: readonly unknown[]; cursor?: string }>(refs.events.read, { ...query })
      return {
        events: result.events.map(decodeEvent),
        cursor: result.cursor as EventCursor | undefined,
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

  const transaction: RuntimeStoreTransaction = {
    state,
    events,
    waiters,
    timers,
    outbox,
    deferred,
  }
  return Object.freeze({
    id: 'convex',
    ...transaction,
    leases,
    runComposite: async <K extends RuntimeCompositeKind>(
      kind: K,
      input: RuntimeCompositeInput[K],
    ): Promise<RuntimeCompositeResult[K]> => {
      if (kind.startsWith('defer.')) {
        assertConvexDeferredComponent(refs.deferred)
      }
      const ref = refs.composites?.run
      if (!ref) {
        throw createRuntimeError({
          code: 'SETUP_REQUIRED',
          whatFailed: 'Convex Runtime Engine component is missing runtime.composites.run.',
          why: 'Runtime Engine composites must execute inside one Convex component mutation for host-bound atomicity.',
          whatStillWorks:
            'Non-runtime Convex storage and already deployed older runtime functions can still run until they hit a composite commit.',
          nextStep:
            'Regenerate or update the Crux Convex component so components.crux.runtime.composites.run is available.',
        })
      }
      return decodeCompositeValue<RuntimeCompositeResult[K]>(
        await run(ref, { kind, input: encodeCompositeValue(input) }),
      )
    },
    transact: <T>(fn: (tx: RuntimeStoreTransaction) => Promise<T>) => fn(transaction),
  })
}

function noop(): void {}

function requireNamespace(namespace: string | undefined, operation: string): string {
  if (namespace) return namespace
  throw createRuntimeError({
    code: 'NAMESPACE_AMBIGUOUS',
    whatFailed: `Convex Runtime Engine ${operation} was called without a namespace.`,
    why: 'The Convex component cannot safely satisfy namespace-less runtime scans without reading unbounded runtime tables.',
    whatStillWorks:
      'Runtime handlers and maintenance created from convex({ namespace }) continue to pass their configured namespace.',
    nextStep: 'Pass an explicit runtime namespace or use a Convex Runtime Engine definition configured with namespace.',
  })
}

function cleanArgs<T extends Record<string, unknown>>(args: T): T {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as T
}
