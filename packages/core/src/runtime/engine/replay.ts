/**
 * Runtime-backed flow replay helpers.
 *
 * The flow executor owns authoring semantics and step replay. This module keeps
 * the Runtime Engine side small: reserved event names for signals and the
 * replay-structure fingerprint check that turns deploy drift into an
 * inspectable `REPLAY_DIVERGED` diagnostic.
 *
 * @module
 */

import { createRuntimeError } from './errors'

/** Input used to create a replay divergence diagnostic. */
export interface ReplayDivergedErrorInput {
  /** Label recorded in the durable snapshot, when one existed. */
  readonly expected: string | undefined
  /** Label observed during the current replay attempt. */
  readonly actual: string
  /** Zero-based label position where replay first diverged. */
  readonly position: number
}

/** Runtime replay fingerprint recorder. */
export interface ReplayFingerprint {
  /** Labels observed during this execution attempt. */
  readonly observed: readonly string[]
  /** Record one replay label and check it against the durable prefix. */
  observe(label: string): void
  /** Check that execution did not end before the durable prefix was replayed. */
  complete(): void
}

/** Options for {@link createReplayFingerprint}. */
export interface ReplayFingerprintOptions {
  /** Durable replay labels recorded by the last suspended execution. */
  readonly recorded?: readonly string[]
}

/**
 * Create an incremental replay fingerprint checker.
 *
 * Recorded labels are treated as the prefix that must be replayed exactly.
 * Once that prefix has been observed, later labels are new execution and may
 * extend the fingerprint normally.
 */
export function createReplayFingerprint(
  options: ReplayFingerprintOptions = {},
): ReplayFingerprint {
  const recorded = options.recorded ?? []
  const observed: string[] = []

  return Object.freeze({
    get observed() {
      return [...observed]
    },
    observe(label: string) {
      const position = observed.length
      const expected = recorded[position]
      if (expected !== undefined && expected !== label) {
        throw replayDivergedError({ expected, actual: label, position })
      }
      observed.push(label)
    },
    complete() {
      if (observed.length >= recorded.length) return
      const position = observed.length
      throw replayDivergedError({
        expected: recorded[position],
        actual: 'end-of-flow',
        position,
      })
    },
  })
}

/** Build the reserved durable event name used by `FlowHandle.signal()`. */
export function runtimeSignalEventName(
  flowId: string,
  signalName: string,
): string {
  return `crux.signal:${flowId}:${signalName}`
}

/** Create the public diagnostic emitted when replay structure has drifted. */
export function replayDivergedError(input: ReplayDivergedErrorInput): Error {
  return createRuntimeError({
    code: 'REPLAY_DIVERGED',
    whatFailed: 'Flow replay diverged from the durable snapshot.',
    why: `Replay expected \`${input.expected ?? 'nothing'}\` at position ${input.position} but observed \`${input.actual}\`.`,
    whatStillWorks:
      'Other flow instances and runtime targets can continue when their snapshots still match the deployed code.',
    nextStep:
      'Restore the missing flow step/suspend label or inspect and retry the blocked work after updating the flow safely.',
  })
}
