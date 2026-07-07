import type { IndexPatch } from '../patches'
import {
  PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
  type ProjectIndexFactBatchEvent,
  type ProjectIndexFactEnvelope,
  type ProjectIndexSourceProfileBatchEvent,
} from './types'

type StreamedSourceProfileFile = NonNullable<IndexPatch['semanticSourceProfile']>['files'][number]

export const DEFAULT_PROJECT_INDEX_WORKER_EVENT_MAX_BYTES = 8 * 1024 * 1024

export interface ProjectIndexWorkerEventBatchOptions {
  /** Transaction id shared by every event in this patch stream. */
  readonly transactionId: string
  /** Maximum items per batch. Count is a secondary cap after bytes. */
  readonly maxItemsPerBatch: number
  /**
   * Maximum serialized bytes per worker event.
   *
   * Individual items larger than the cap are emitted alone; the host's
   * per-line reader cap remains the hard failure boundary for those cases.
   */
  readonly maxEventBytes?: number
}

interface NormalizedWorkerEventBatchOptions extends ProjectIndexWorkerEventBatchOptions {
  readonly maxEventBytes: number
}

/** Streams `fact:batch` events bounded by serialized event bytes and count. */
export function* projectIndexFactBatchEvents(
  facts: Iterable<ProjectIndexFactEnvelope>,
  options: ProjectIndexWorkerEventBatchOptions,
): Iterable<ProjectIndexFactBatchEvent> {
  yield* projectIndexWorkerItemBatchEvents(facts, normalizedBatchOptions(options), (batch, sequence) => ({
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'fact:batch',
    transactionId: options.transactionId,
    sequence,
    facts: batch,
  }))
}

/** Streams `sourceProfile:batch` events bounded by serialized event bytes and count. */
export function* projectIndexSourceProfileBatchEvents(
  files: readonly StreamedSourceProfileFile[],
  options: ProjectIndexWorkerEventBatchOptions,
): Iterable<ProjectIndexSourceProfileBatchEvent> {
  yield* projectIndexWorkerItemBatchEvents(files, normalizedBatchOptions(options), (batch, sequence) => ({
    protocolVersion: PROJECT_INDEX_WORKER_PROTOCOL_VERSION,
    type: 'sourceProfile:batch',
    transactionId: options.transactionId,
    sequence,
    files: batch,
  }))
}

function* projectIndexWorkerItemBatchEvents<TItem, TEvent>(
  items: Iterable<TItem>,
  options: NormalizedWorkerEventBatchOptions,
  createEvent: (batch: readonly TItem[], sequence: number) => TEvent,
): Iterable<TEvent> {
  let batch: TItem[] = []
  let sequence = 0

  for (const item of items) {
    if (batch.length > 0 && shouldFlushWorkerEventBatch(batch, item, sequence, options, createEvent)) {
      yield createEvent(batch, sequence)
      sequence += 1
      batch = []
    }

    batch.push(item)
    if (batch.length >= options.maxItemsPerBatch) {
      yield createEvent(batch, sequence)
      sequence += 1
      batch = []
    }
  }

  if (batch.length > 0) yield createEvent(batch, sequence)
}

function shouldFlushWorkerEventBatch<TItem, TEvent>(
  batch: readonly TItem[],
  item: TItem,
  sequence: number,
  options: NormalizedWorkerEventBatchOptions,
  createEvent: (batch: readonly TItem[], sequence: number) => TEvent,
): boolean {
  if (batch.length >= options.maxItemsPerBatch) return true
  return serializedEventBytes(createEvent([...batch, item], sequence)) > options.maxEventBytes
}

function normalizedBatchOptions(options: ProjectIndexWorkerEventBatchOptions): NormalizedWorkerEventBatchOptions {
  return {
    ...options,
    maxItemsPerBatch: Math.max(1, options.maxItemsPerBatch),
    maxEventBytes: Math.max(1, options.maxEventBytes ?? DEFAULT_PROJECT_INDEX_WORKER_EVENT_MAX_BYTES),
  }
}

function serializedEventBytes(event: unknown): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}
