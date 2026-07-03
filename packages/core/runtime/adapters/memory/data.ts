import type { RuntimeEvent } from '../../ports/events'
import type { Lease } from '../../ports/leases'
import type { FlowSnapshot, IdempotencyRecord } from '../../ports/state'
import type { RuntimeWaiter } from '../../ports/waiters'
import type { WorkItem } from '../../engine/work'
import type { RuntimeOutboxItem, RuntimeTimerRecord } from '../../store'

export type MemoryWriteRecorder = () => void

export interface MemoryRuntimeData {
  work: Map<string, WorkItem>
  snapshots: Map<string, FlowSnapshot>
  idempotency: Map<string, IdempotencyRecord>
  leases: Map<string, Lease>
  readonly events: RuntimeEvent[]
  eventsByDuplicateKey: Map<string, RuntimeEvent>
  waiters: Map<string, RuntimeWaiter>
  timers: Map<string, RuntimeTimerRecord>
  timerDuplicateKeys: Map<string, RuntimeTimerRecord>
  outbox: Map<string, RuntimeOutboxItem>
  idleCounters: Map<string, number>
  nextEventId: number
  nextWaiterId: number
  nextLeaseId: number
  nextTimerId: number
  nextOutboxId: number
}

export function createMemoryRuntimeData(): MemoryRuntimeData {
  return {
    work: new Map(),
    snapshots: new Map(),
    idempotency: new Map(),
    leases: new Map(),
    events: [],
    eventsByDuplicateKey: new Map(),
    waiters: new Map(),
    timers: new Map(),
    timerDuplicateKeys: new Map(),
    outbox: new Map(),
    idleCounters: new Map(),
    nextEventId: 1,
    nextWaiterId: 1,
    nextLeaseId: 1,
    nextTimerId: 1,
    nextOutboxId: 1,
  }
}

export function cloneMemoryRuntimeData(data: MemoryRuntimeData): MemoryRuntimeData {
  return {
    work: new Map(data.work),
    snapshots: new Map(data.snapshots),
    idempotency: new Map(data.idempotency),
    leases: new Map(data.leases),
    events: [...data.events],
    eventsByDuplicateKey: new Map(data.eventsByDuplicateKey),
    waiters: new Map(data.waiters),
    timers: new Map(data.timers),
    timerDuplicateKeys: new Map(data.timerDuplicateKeys),
    outbox: new Map(data.outbox),
    idleCounters: new Map(data.idleCounters),
    nextEventId: data.nextEventId,
    nextWaiterId: data.nextWaiterId,
    nextLeaseId: data.nextLeaseId,
    nextTimerId: data.nextTimerId,
    nextOutboxId: data.nextOutboxId,
  }
}

export function replaceMemoryRuntimeData(
  target: MemoryRuntimeData,
  source: MemoryRuntimeData,
): void {
  target.work = source.work
  target.snapshots = source.snapshots
  target.idempotency = source.idempotency
  target.leases = source.leases
  target.events.splice(0, target.events.length, ...source.events)
  target.eventsByDuplicateKey = source.eventsByDuplicateKey
  target.waiters = source.waiters
  target.timers = source.timers
  target.timerDuplicateKeys = source.timerDuplicateKeys
  target.outbox = source.outbox
  target.idleCounters = source.idleCounters
  target.nextEventId = source.nextEventId
  target.nextWaiterId = source.nextWaiterId
  target.nextLeaseId = source.nextLeaseId
  target.nextTimerId = source.nextTimerId
  target.nextOutboxId = source.nextOutboxId
}

export function scopedKey(namespace: string, key: string): string {
  return `${namespace}\0${key}`
}
