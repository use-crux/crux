import {
  inMemoryRuntimeStore,
  runtimeCompositeBodies,
  type RuntimeCompositeInput,
  type WakeEnvelope,
  type WorkId,
  type WorkItem,
} from '@use-crux/core/runtime'
import {
  decodeCompositeValue,
  decodeLease,
  decodeWork,
  encodeCompositeValue,
  encodeLease,
  encodeOutboxDate,
  encodeWork,
} from '../../../src/runtime-engine/codec'
import type { ConvexRuntimeComponent } from '../../../src/runtime'

const refs = {
  state: {
    getWork: Symbol('state.getWork'),
    putWork: Symbol('state.putWork'),
    countWork: Symbol('state.countWork'),
    hasIdempotencyKey: Symbol('state.hasIdempotencyKey'),
  },
  outbox: {
    put: Symbol('outbox.put'),
    claimPending: Symbol('outbox.claimPending'),
    confirm: Symbol('outbox.confirm'),
    retryLater: Symbol('outbox.retryLater'),
  },
  leases: {
    claim: Symbol('leases.claim'),
    release: Symbol('leases.release'),
  },
  composites: { run: Symbol('composites.run') },
  results: {
    put: Symbol('results.put'),
    get: Symbol('results.get'),
    deleteResult: Symbol('results.delete'),
    pruneUnreferenced: Symbol('results.prune'),
  },
  evalHost: { admit: Symbol('evalHost.admit') },
}

/** In-process action/component boundary fake retaining Convex wire encodings. */
export function createConvexEvalActionHarness() {
  const memory = inMemoryRuntimeStore()
  const scheduled: WakeEnvelope[] = []
  const results = new Map<string, Record<string, unknown>>()
  let generatedWorkId = 0
  const component = {
    runtime: {
      ...refs,
      events: {},
      waiters: {},
      timers: {},
      deferred: {},
    },
  } satisfies ConvexRuntimeComponent

  const ctx = {
    scheduler: {
      async runAfter(_delayMs: number, _ref: unknown, args: Record<string, unknown>) {
        scheduled.push(args.envelope as WakeEnvelope)
      },
    },
    async runMutation<TResult>(ref: unknown, args: Record<string, unknown>): Promise<TResult> {
      if (ref === refs.evalHost.admit) return (await admit(args)) as TResult
      if (ref === refs.state.getWork) {
        const work = await memory.state.getWork(args.workId as WorkId, {
          namespace: String(args.namespace),
        })
        return (work ? encodeWork(work) : null) as TResult
      }
      if (ref === refs.state.countWork) {
        return (await memory.state.countWork({
          namespace: String(args.namespace),
        })) as TResult
      }
      if (ref === refs.state.putWork) {
        await memory.state.putWork(decodeWork(args.work))
        return null as TResult
      }
      if (ref === refs.state.hasIdempotencyKey) {
        return (await memory.state.hasIdempotencyKey(String(args.namespace), String(args.key))) as TResult
      }
      if (ref === refs.leases.claim) {
        const lease = await memory.leases.claim(String(args.resource), {
          ttlMs: Number(args.ttlMs),
          ownerId: typeof args.ownerId === 'string' ? args.ownerId : undefined,
        })
        return (lease ? encodeLease(lease) : null) as TResult
      }
      if (ref === refs.leases.release) {
        await memory.leases.release(decodeLease(args.lease)!)
        return null as TResult
      }
      if (ref === refs.composites.run) {
        if (args.kind === 'wake.complete') {
          return encodeCompositeValue(
            await runComposite(
              'wake.complete',
              decodeCompositeValue<RuntimeCompositeInput['wake.complete']>(args.input),
            ),
          ) as TResult
        }
        if (args.kind === 'wake.retry') {
          return encodeCompositeValue(
            await runComposite('wake.retry', decodeCompositeValue<RuntimeCompositeInput['wake.retry']>(args.input)),
          ) as TResult
        }
        if (args.kind === 'wake.fail') {
          return encodeCompositeValue(
            await runComposite('wake.fail', decodeCompositeValue<RuntimeCompositeInput['wake.fail']>(args.input)),
          ) as TResult
        }
        throw new Error(`Unexpected composite ${String(args.kind)}.`)
      }
      if (ref === refs.results.put) {
        results.set(String(args.location), args)
        return null as TResult
      }
      if (ref === refs.results.get) return (results.get(String(args.location)) ?? null) as TResult
      if (ref === refs.outbox.claimPending) {
        const items = await memory.outbox.claimPending({
          namespace: String(args.namespace),
          now: new Date(Number(args.now)),
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        })
        return items.map((item) => ({
          ...item,
          nextAttemptAt: encodeOutboxDate(item.nextAttemptAt),
        })) as TResult
      }
      if (ref === refs.outbox.put) {
        const item = await memory.outbox.put(args.envelope as WakeEnvelope, {
          deliverAt: new Date(Number(args.nextAttemptAt)),
        })
        return {
          ...item,
          nextAttemptAt: encodeOutboxDate(item.nextAttemptAt),
        } as TResult
      }
      if (ref === refs.outbox.confirm) {
        await memory.outbox.confirm(String(args.outboxId))
        return null as TResult
      }
      if (ref === refs.outbox.retryLater) {
        await memory.outbox.retryLater(String(args.outboxId), new Date(Number(args.nextAttemptAt)))
        return null as TResult
      }
      throw new Error(`Unexpected Convex component ref ${String(ref)}.`)
    },
  }

  async function admit(args: Record<string, unknown>): Promise<unknown> {
    return await memory.transact(async (tx) => {
      const workId = args.workId as WorkId
      const namespace = String(args.namespace)
      const existing = await tx.state.getWork(workId, { namespace })
      if (existing)
        return encodeCompositeValue({
          kind: 'admitted',
          work: existing,
          created: false,
        })
      const job = args.job as Record<string, unknown>
      const now = new Date(Number(args.now))
      const work = await tx.state.createWork({
        workId,
        namespace,
        work: {
          kind: 'task.run',
          taskId: String(job.jobId) as never,
          targetId: '_crux.eval.execute' as never,
          input: job as never,
        },
        targetId: '_crux.eval.execute' as never,
        idempotencyKey: `task:${workId}`,
        now,
      })
      await tx.outbox.put(wakeFor(work), { deliverAt: now })
      return encodeCompositeValue({ kind: 'admitted', work, created: true })
    })
  }

  function runComposite<K extends 'wake.complete' | 'wake.retry' | 'wake.fail'>(
    kind: K,
    input: RuntimeCompositeInput[K],
  ) {
    return memory.transact((tx) =>
      runtimeCompositeBodies[kind](
        tx,
        {
          now: () => NOW,
          newWorkId: () => `convex-harness:${++generatedWorkId}` as WorkId,
        },
        input,
      ),
    )
  }

  return { component, ctx, memory, scheduled, results }
}

const NOW = new Date('2026-07-16T18:00:00.000Z')

function wakeFor(work: WorkItem): WakeEnvelope {
  return {
    v: 1,
    ns: work.namespace,
    workId: work.workId,
    target: work.targetId,
    kind: work.work.kind,
    idempotencyKey: work.idempotencyKey,
    attempt: work.attempt,
  }
}
