import type { WakeEnvelope } from '../../engine/envelope'
import type { RuntimeOutboxItem, RuntimeOutboxPort } from '../../store'
import type { MemoryRuntimeData, MemoryWriteRecorder } from './data'

export interface MemoryOutboxFaults {
  crashBeforeConfirm: boolean
}

export function createMemoryOutboxPort(
  data: MemoryRuntimeData,
  faults: MemoryOutboxFaults,
  recordWrite?: MemoryWriteRecorder,
): RuntimeOutboxPort {
  return {
    async put(envelope: WakeEnvelope, options = {}): Promise<RuntimeOutboxItem> {
      const deliverAt = new Date(options.deliverAt ?? new Date())
      const existing = [...data.outbox.values()].find(
        (item) =>
          item.state === 'pending' &&
          item.namespace === envelope.ns &&
          item.envelope.idempotencyKey === envelope.idempotencyKey &&
          item.nextAttemptAt.getTime() === deliverAt.getTime(),
      )
      if (existing) return cloneOutboxItem(existing)

      recordWrite?.()
      const stored: RuntimeOutboxItem = Object.freeze({
        outboxId: `outbox_${data.nextOutboxId}`,
        namespace: envelope.ns,
        envelope: cloneWakeEnvelope(envelope),
        state: 'pending',
        attempts: 0,
        nextAttemptAt: deliverAt,
      })
      data.nextOutboxId += 1
      data.outbox.set(stored.outboxId, stored)
      return cloneOutboxItem(stored)
    },

    async get(outboxId: string): Promise<RuntimeOutboxItem | null> {
      const item = data.outbox.get(outboxId)
      return item ? cloneOutboxItem(item) : null
    },

    async claimPending(options): Promise<readonly RuntimeOutboxItem[]> {
      const claimable = [...data.outbox.values()]
        .filter(
          (item) =>
            item.state !== 'confirmed' &&
            item.nextAttemptAt.getTime() <= options.now.getTime() &&
            (options.namespace === undefined ||
              item.namespace === options.namespace),
        )
        .slice(0, options.limit)

      return claimable.map((item) => {
        recordWrite?.()
        const claimed: RuntimeOutboxItem = Object.freeze({
          ...item,
          envelope: cloneWakeEnvelope(item.envelope),
          state: 'dispatched',
          attempts: item.attempts + 1,
          nextAttemptAt: new Date(item.nextAttemptAt),
        })
        data.outbox.set(item.outboxId, claimed)
        return cloneOutboxItem(claimed)
      })
    },

    async list(options): Promise<readonly RuntimeOutboxItem[]> {
      const rows = [...data.outbox.values()]
        .filter(
          (item) =>
            item.namespace === options.namespace &&
            (options.state === undefined || item.state === options.state),
        )
        .slice(0, options.limit)
      return rows.map((item) => cloneOutboxItem(item))
    },

    async confirm(outboxId: string): Promise<void> {
      if (faults.crashBeforeConfirm) {
        faults.crashBeforeConfirm = false
        throw new Error('Injected outbox confirm crash')
      }
      const item = data.outbox.get(outboxId)
      if (!item || item.state === 'confirmed') return
      recordWrite?.()
      data.outbox.set(
        outboxId,
        Object.freeze({
          ...item,
          envelope: cloneWakeEnvelope(item.envelope),
          state: 'confirmed',
          nextAttemptAt: new Date(item.nextAttemptAt),
        }),
      )
    },

    async retryLater(outboxId: string, nextAttemptAt: Date): Promise<void> {
      const item = data.outbox.get(outboxId)
      if (!item || item.state === 'confirmed') return
      recordWrite?.()
      data.outbox.set(
        outboxId,
        Object.freeze({
          ...item,
          envelope: cloneWakeEnvelope(item.envelope),
          state: 'pending',
          nextAttemptAt: new Date(nextAttemptAt),
        }),
      )
    },
  }
}

export function cloneOutboxItem(item: RuntimeOutboxItem): RuntimeOutboxItem {
  return Object.freeze({
    outboxId: item.outboxId,
    namespace: item.namespace,
    envelope: cloneWakeEnvelope(item.envelope),
    state: item.state,
    attempts: item.attempts,
    nextAttemptAt: new Date(item.nextAttemptAt),
  })
}

function cloneWakeEnvelope(envelope: WakeEnvelope): WakeEnvelope {
  return Object.freeze({
    v: envelope.v,
    ns: envelope.ns,
    workId: envelope.workId,
    target: envelope.target,
    kind: envelope.kind,
    idempotencyKey: envelope.idempotencyKey,
    attempt: envelope.attempt,
  })
}
