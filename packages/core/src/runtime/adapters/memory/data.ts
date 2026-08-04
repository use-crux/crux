import type { RuntimeEvent } from "../../ports/events";
import type { Lease } from "../../ports/leases";
import type { FlowSnapshot, IdempotencyRecord } from "../../ports/state";
import type { RuntimeWaiter } from "../../ports/waiters";
import type {
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
} from "../../ports/deferred";
import type { RuntimeWorkItem } from "../../engine/work";
import type {
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "../../reactive/records";
import type { RuntimeOutboxItem, RuntimeTimerRecord } from "../../store";
import type { WorkControlRecord } from "../../ports/work-control";
import type {
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
} from "../../ports/sessions";

export type MemoryWriteRecorder = () => void;

export interface MemoryRuntimeTimerRecord extends RuntimeTimerRecord {
  readonly settledAt?: Date;
}

export interface MemoryRuntimeWaiter extends RuntimeWaiter {
  readonly settledAt?: Date;
}

export interface MemoryRuntimeOutboxItem extends RuntimeOutboxItem {
  readonly confirmedAt?: Date;
}

export interface MemoryRuntimeResultRecord {
  readonly namespace: string;
  readonly json: string;
  readonly createdAt: Date;
}

export interface MemoryRuntimeData {
  work: Map<string, RuntimeWorkItem>;
  snapshots: Map<string, FlowSnapshot>;
  idempotency: Map<string, IdempotencyRecord>;
  leases: Map<string, Lease>;
  readonly events: RuntimeEvent[];
  eventsByDuplicateKey: Map<string, RuntimeEvent>;
  waiters: Map<string, MemoryRuntimeWaiter>;
  timers: Map<string, MemoryRuntimeTimerRecord>;
  timerDuplicateKeys: Map<string, MemoryRuntimeTimerRecord>;
  outbox: Map<string, MemoryRuntimeOutboxItem>;
  idleCounters: Map<string, number>;
  deferredScopes: Map<string, RuntimeDeferredScope>;
  deferredIntents: Map<string, RuntimeDeferredIntent>;
  results: Map<string, MemoryRuntimeResultRecord>;
  signalOccurrences: Map<string, SignalOccurrenceRecord>;
  signalIdempotency: Map<string, string>;
  signalDeliveries: Map<string, SignalDeliveryRecord>;
  workControl: Map<string, WorkControlRecord>;
  sessionsByKey: Map<string, RuntimeSessionRecord>;
  sessionsById: Map<string, RuntimeSessionRecord>;
  sessionInputs: Map<string, RuntimeSessionInputRecord>;
  nextEventId: number;
  nextWaiterId: number;
  nextLeaseId: number;
  nextTimerId: number;
  nextOutboxId: number;
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
    deferredScopes: new Map(),
    deferredIntents: new Map(),
    results: new Map(),
    signalOccurrences: new Map(),
    signalIdempotency: new Map(),
    signalDeliveries: new Map(),
    workControl: new Map(),
    sessionsByKey: new Map(),
    sessionsById: new Map(),
    sessionInputs: new Map(),
    nextEventId: 1,
    nextWaiterId: 1,
    nextLeaseId: 1,
    nextTimerId: 1,
    nextOutboxId: 1,
  };
}

export function cloneMemoryRuntimeData(
  data: MemoryRuntimeData,
): MemoryRuntimeData {
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
    deferredScopes: new Map(data.deferredScopes),
    deferredIntents: new Map(data.deferredIntents),
    results: new Map(
      [...data.results].map(([location, result]) => [
        location,
        { ...result, createdAt: new Date(result.createdAt) },
      ]),
    ),
    signalOccurrences: new Map(data.signalOccurrences),
    signalIdempotency: new Map(data.signalIdempotency),
    signalDeliveries: new Map(data.signalDeliveries),
    workControl: new Map(data.workControl),
    sessionsByKey: new Map(data.sessionsByKey),
    sessionsById: new Map(data.sessionsById),
    sessionInputs: new Map(data.sessionInputs),
    nextEventId: data.nextEventId,
    nextWaiterId: data.nextWaiterId,
    nextLeaseId: data.nextLeaseId,
    nextTimerId: data.nextTimerId,
    nextOutboxId: data.nextOutboxId,
  };
}

export function replaceMemoryRuntimeData(
  target: MemoryRuntimeData,
  source: MemoryRuntimeData,
): void {
  target.work = source.work;
  target.snapshots = source.snapshots;
  target.idempotency = source.idempotency;
  // Leases are outside RuntimeStoreTransaction and may change concurrently.
  target.events.splice(0, target.events.length, ...source.events);
  target.eventsByDuplicateKey = source.eventsByDuplicateKey;
  target.waiters = source.waiters;
  target.timers = source.timers;
  target.timerDuplicateKeys = source.timerDuplicateKeys;
  target.outbox = source.outbox;
  target.idleCounters = source.idleCounters;
  target.deferredScopes = source.deferredScopes;
  target.deferredIntents = source.deferredIntents;
  target.results = source.results;
  target.signalOccurrences = source.signalOccurrences;
  target.signalIdempotency = source.signalIdempotency;
  target.signalDeliveries = source.signalDeliveries;
  target.workControl = source.workControl;
  target.sessionsByKey = source.sessionsByKey;
  target.sessionsById = source.sessionsById;
  target.sessionInputs = source.sessionInputs;
  target.nextEventId = source.nextEventId;
  target.nextWaiterId = source.nextWaiterId;
  target.nextTimerId = source.nextTimerId;
  target.nextOutboxId = source.nextOutboxId;
}

export function scopedKey(namespace: string, key: string): string {
  return `${namespace}\0${key}`;
}
