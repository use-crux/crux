import type {
  MemoryBlock,
  MemoryBlockContext,
  MemoryCaptureMode,
  MemoryMessage,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
} from '../block-contracts'
import {
  scheduleMemoryCapture,
  type MemoryCaptureSchedulingResult,
} from './scheduling'
import { startMemoryCaptureObservation } from './observability'

type CaptureOptions = Readonly<Partial<MemoryRuntimeOptions>> & {
  readonly input?: Record<string, unknown>
}

interface PendingCapture {
  readonly sequence: number
  readonly epoch: number
  readonly status: 'inline' | 'deferred' | 'captured'
  readonly settled: Promise<void>
}

interface CaptureFailure {
  readonly sequence: number
  readonly status: 'inline' | 'deferred'
  readonly error: unknown
}

/** Construction contract for one memory-owned capture runtime. */
export interface MemoryCaptureRuntimeOptions {
  /** Authored memory id used for payload-free lifecycle evidence. */
  readonly memoryId: string
  readonly mode: MemoryCaptureMode
  readonly blocks: readonly MemoryBlock[]
  readonly createContext: (options: CaptureOptions) => Promise<MemoryBlockContext>
}

/** Capture and flush operations owned by one composed memory instance. */
export interface MemoryCaptureRuntime {
  captureTurn(turn: MemoryTurn, options?: CaptureOptions): Promise<void>
  captureToolEvent(event: MemoryToolEvent, options?: CaptureOptions): Promise<void>
  flush(options?: CaptureOptions): Promise<void>
}

/**
 * Create the lifecycle runtime for one `memory()` composition.
 *
 * The runtime snapshots accepted values, executes block hooks in declaration
 * order, and retains only pending settlements plus the earliest deferred
 * failure in each open flush epoch.
 */
export function createMemoryCaptureRuntime(
  options: MemoryCaptureRuntimeOptions,
): MemoryCaptureRuntime {
  const blocks = Object.freeze([...options.blocks])
  const pending = new Map<number, PendingCapture>()
  const deferredFailures = new Map<number, CaptureFailure>()
  let nextSequence = 1
  let acceptanceEpoch = 0
  let consumedDeferredThroughSequence = 0
  let flushTail = Promise.resolve()

  async function accept(
    operation: 'turn' | 'tool-event',
    toolEventCount: number,
    work: () => Promise<void>,
  ): Promise<void> {
    const sequence = nextSequence++
    const epoch = acceptanceEpoch
    const observation = startMemoryCaptureObservation({
      memoryId: options.memoryId,
      operation,
      requestedMode: options.mode,
      sequence,
      blockCount: blocks.length,
      toolEventCount,
    })
    let scheduled: MemoryCaptureSchedulingResult
    try {
      scheduled = scheduleMemoryCapture(options.mode, () =>
        Promise.resolve(observation.withContext(work)),
      )
      observation.setDisposition(scheduled.status)
    } catch (error) {
      observation.fail(error)
      throw error
    }
    const tracked = scheduled.settled.then(
      () => {
        pending.delete(sequence)
        observation.complete(scheduled.status)
      },
      (error: unknown) => {
        pending.delete(sequence)
        observation.fail(error)
        if (scheduled.status === 'deferred' && !deferredFailures.has(epoch)) {
          deferredFailures.set(epoch, {
            sequence,
            status: 'deferred',
            error,
          })
        }
        throw error
      },
    )
    void tracked.catch(() => undefined)
    pending.set(sequence, {
      sequence,
      epoch,
      status: scheduled.status,
      settled: tracked,
    })
    if (scheduled.status === 'inline') await tracked
  }

  async function captureTurn(
    turn: MemoryTurn,
    captureOptions: CaptureOptions = {},
  ): Promise<void> {
    const snapshot = snapshotTurn(turn)
    await accept('turn', snapshot.toolEvents?.length ?? 0, async () => {
      const context = await options.createContext(captureOptions)
      for (const block of blocks) {
        await block.captureTurn?.(snapshot, context)
      }
      for (const event of snapshot.toolEvents ?? []) {
        for (const block of blocks) {
          await block.captureToolEvent?.(event, context)
        }
      }
    })
  }

  async function captureToolEvent(
    event: MemoryToolEvent,
    captureOptions: CaptureOptions = {},
  ): Promise<void> {
    const snapshot = snapshotToolEvent(event)
    await accept('tool-event', 1, async () => {
      const context = await options.createContext(captureOptions)
      for (const block of blocks) {
        await block.captureToolEvent?.(snapshot, context)
      }
    })
  }

  function flush(captureOptions: CaptureOptions = {}): Promise<void> {
    const cutoff = nextSequence - 1
    const closingEpoch = acceptanceEpoch++
    const settlements = [...pending.values()]
      .filter((entry) => entry.sequence <= cutoff)
      .map((entry) => ({
        sequence: entry.sequence,
        status: entry.status,
        settled: entry.settled,
      }))
    const run = flushTail.then(
      () => runFlush(cutoff, closingEpoch, settlements, captureOptions),
      () => runFlush(cutoff, closingEpoch, settlements, captureOptions),
    )
    flushTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function runFlush(
    cutoff: number,
    closingEpoch: number,
    settlements: readonly {
      readonly sequence: number
      readonly status: 'inline' | 'deferred' | 'captured'
      readonly settled: Promise<void>
    }[],
    captureOptions: CaptureOptions,
  ): Promise<void> {
    const results = await Promise.allSettled(
      settlements.map(({ settled }) => settled),
    )
    const candidates: CaptureFailure[] = []
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]
      if (result?.status === 'rejected') {
        const settlement = settlements[index]!
        if (
          settlement.status === 'deferred' &&
          settlement.sequence <= consumedDeferredThroughSequence
        ) {
          continue
        }
        candidates.push({
          sequence: settlement.sequence,
          status:
            settlement.status === 'deferred' ? 'deferred' : 'inline',
          error: result.reason,
        })
      }
    }
    for (const [epoch, failure] of deferredFailures) {
      if (epoch <= closingEpoch) candidates.push(failure)
    }
    for (const [epoch] of deferredFailures) {
      if (epoch <= closingEpoch) {
        deferredFailures.delete(epoch)
      }
    }
    consumedDeferredThroughSequence = Math.max(
      consumedDeferredThroughSequence,
      cutoff,
    )
    const failure = candidates.sort(
      (left, right) => left.sequence - right.sequence,
    )[0]
    if (failure) throw failure.error

    const context = await options.createContext(captureOptions)
    for (const block of blocks) await block.flush?.(context)
  }

  return Object.freeze({ captureTurn, captureToolEvent, flush })
}

function snapshotTurn(turn: MemoryTurn): MemoryTurn {
  const messages = Object.freeze(turn.messages.map(snapshotMessage))
  const toolEvents = turn.toolEvents
    ? Object.freeze(turn.toolEvents.map(snapshotToolEvent))
    : undefined
  return Object.freeze({
    ...turn,
    messages,
    ...(toolEvents ? { toolEvents } : {}),
    ...(turn.source ? { source: Object.freeze({ ...turn.source }) } : {}),
    ...(turn.metadata
      ? { metadata: Object.freeze({ ...turn.metadata }) }
      : {}),
  })
}

function snapshotMessage(message: MemoryMessage): MemoryMessage {
  return Object.freeze({
    ...message,
    ...(message.metadata
      ? { metadata: Object.freeze({ ...message.metadata }) }
      : {}),
  })
}

function snapshotToolEvent(event: MemoryToolEvent): MemoryToolEvent {
  return Object.freeze({ ...event })
}
