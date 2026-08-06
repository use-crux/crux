import type { RuntimeStatePort } from '@use-crux/core/runtime'
import { decodeSnapshot, decodeWork, encodeIdempotency, encodeSnapshot, encodeWork, encodeWorkForCreate } from './codec'
import { noop } from './store-utils'

/** Bind Runtime state and idempotency operations to component mutations. */
export function createConvexStateStore(options: {
  readonly refs: Record<string, unknown>
  readonly run: <TResult>(ref: unknown, args: Record<string, unknown>) => Promise<TResult>
  readonly now: () => Date
}): RuntimeStatePort {
  const { refs, run, now } = options
  return {
    createWork: async (work) => decodeWork(await run(refs.createWork, { work: encodeWorkForCreate(work) })),
    getWork: async (workId, read) => {
      const result = await run<unknown>(refs.getWork, {
        workId,
        namespace: read.namespace,
      })
      return result ? decodeWork(result) : null
    },
    putWork: (work) => run(refs.putWork, { work: encodeWork(work) }).then(noop),
    listWork: async (query) =>
      (
        await run<readonly unknown[]>(refs.listWork, {
          ...query,
          updatedBefore: query.updatedBefore?.getTime(),
        })
      ).map(decodeWork),
    pruneTerminalWork: (query) => run(refs.pruneTerminalWork, { ...query, before: query.before.getTime() }),
    countWork: (query) => run(refs.countWork, { ...query }),
    setWorkPending: async (workId, pending) => {
      const result = await run<unknown>(refs.setWorkPending, {
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
      const result = await run<unknown>(refs.getSnapshot, {
        flowId,
        namespace: read.namespace,
      })
      return result ? decodeSnapshot(result) : null
    },
    putSnapshot: (snapshot) => run(refs.putSnapshot, { snapshot: encodeSnapshot(snapshot) }).then(noop),
    pruneTerminalSnapshots: (query) =>
      run(refs.pruneTerminalSnapshots, {
        ...query,
        before: query.before.getTime(),
      }),
    markSnapshotDelivered: (workId, delivery) => run(refs.markSnapshotDelivered, { workId, ...delivery }).then(noop),
    hasIdempotencyKey: (namespace, key) => run(refs.hasIdempotencyKey, { namespace, key }),
    putIdempotencyKey: (record) => run(refs.putIdempotencyKey, { record: encodeIdempotency(record) }).then(noop),
    pruneIdempotencyKeys: (query) =>
      run(refs.pruneIdempotencyKeys, {
        ...query,
        before: query.before.getTime(),
      }),
    incrementIdle: (namespace, scope) => run(refs.incrementIdle, { namespace, scope }),
    decrementIdle: (namespace, scope) => run(refs.decrementIdle, { namespace, scope }),
    getIdleCount: (namespace, scope) => run(refs.getIdleCount, { namespace, scope }),
  }
}
