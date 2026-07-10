/**
 * In-memory Runtime Engine store adapter.
 *
 * This adapter is process-local and intended for tests, local development, and
 * the future `node()` composer. It follows the same record semantics as
 * durable stores so conformance tests can exercise kernel invariants without a
 * database.
 *
 * @module
 */

import type { DurableEventPort } from '../../ports/events'
import type { LeasePort } from '../../ports/leases'
import type { RuntimeStatePort } from '../../ports/state'
import type {
  RuntimeOutboxPort,
  RuntimeStoreAdapter,
  RuntimeStoreTransaction,
  RuntimeTimerStorePort,
} from '../../store'
import { createMemoryRuntimeData } from './data'
import { cloneMemoryRuntimeData, replaceMemoryRuntimeData } from './data'
import { createMemoryEventPort } from './events'
import { createMemoryLeasePort } from './leases'
import { createAsyncMutex } from './mutex'
import type { MemoryOutboxFaults } from './outbox'
import { createMemoryOutboxPort } from './outbox'
import { createMemoryStatePort } from './state'
import { createMemoryTimerStore } from './timers'
import type { MemoryWaiterPort } from './waiters'
import { createMemoryWaiterPort } from './waiters'

/** Fault-injection controls used by adapter conformance tests. */
export interface InMemoryRuntimeStoreTesting {
  /** Fail a transaction after `writes` successful writes to prove rollback. */
  failAfter(writes: number): void
  /** Throw once before confirming the next outbox item. */
  crashBeforeConfirm(): void
}

/** Process-local runtime store reference implementation. */
export interface InMemoryRuntimeStore extends RuntimeStoreAdapter {
  /** Fault-injection controls for conformance tests. */
  readonly testing: InMemoryRuntimeStoreTesting
  /** Stable adapter id used in conformance output. */
  readonly id: 'memory'
  /** Durable runtime state for work, snapshots, and idempotency keys. */
  readonly state: RuntimeStatePort
  /** Durable event port backed by in-memory records. */
  readonly events: DurableEventPort
  /** Durable waiter correlation port backed by in-memory records. */
  readonly waiters: MemoryWaiterPort
  /** Store-backed timer records. */
  readonly timers: RuntimeTimerStorePort
  /** Store-backed wake outbox records. */
  readonly outbox: RuntimeOutboxPort
  /** Durable lease port backed by in-memory records. */
  readonly leases: LeasePort
}

/** Create a fresh, isolated in-memory runtime store. */
export function inMemoryRuntimeStore(): InMemoryRuntimeStore {
  const data = createMemoryRuntimeData()
  const outboxFaults: MemoryOutboxFaults = { crashBeforeConfirm: false }
  const transactionMutex = createAsyncMutex()
  let failAfterWrites: number | undefined

  function portsFor(
    target = data,
    recordWrite?: () => void,
  ): RuntimeStoreTransaction {
    return {
      state: createMemoryStatePort(target, recordWrite),
      events: createMemoryEventPort(target, recordWrite),
      waiters: createMemoryWaiterPort(target, recordWrite),
      timers: createMemoryTimerStore(target, recordWrite),
      outbox: createMemoryOutboxPort(target, outboxFaults, recordWrite),
    }
  }

  const ports = portsFor()
  return Object.freeze({
    id: 'memory' as const,
    ...ports,
    leases: createMemoryLeasePort(data),
    async transact<T>(
      fn: (tx: RuntimeStoreTransaction) => Promise<T>,
    ): Promise<T> {
      return transactionMutex.run(async () => {
        const draft = cloneMemoryRuntimeData(data)
        const configuredFailure = failAfterWrites
        failAfterWrites = undefined
        let writeCount = 0
        const tx = portsFor(draft, () => {
          writeCount += 1
          if (
            configuredFailure !== undefined &&
            writeCount > configuredFailure
          ) {
            throw new Error('Injected transaction failure')
          }
        })
        const result = await fn(tx)
        replaceMemoryRuntimeData(data, draft)
        return result
      })
    },
    testing: Object.freeze({
      failAfter(writes: number): void {
        failAfterWrites = writes
      },
      crashBeforeConfirm(): void {
        outboxFaults.crashBeforeConfirm = true
      },
    }),
  })
}
