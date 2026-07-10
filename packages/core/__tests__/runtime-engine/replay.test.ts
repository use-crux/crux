import { describe, expect, it } from 'vitest'
import { CruxRuntimeError } from '../../src/runtime/engine/errors'
import {
  createReplayFingerprint,
  replayDivergedError,
  runtimeSignalEventName,
} from '../../src/runtime/engine/replay'

describe('runtime replay helpers', () => {
  it('checks recorded fingerprint labels as a prefix and then allows new labels', () => {
    const fingerprint = createReplayFingerprint({
      recorded: ['step:plan', 'suspend:approval'],
    })

    fingerprint.observe('step:plan')
    fingerprint.observe('suspend:approval')
    fingerprint.observe('step:publish')

    expect(fingerprint.observed).toEqual([
      'step:plan',
      'suspend:approval',
      'step:publish',
    ])
    expect(() => fingerprint.complete()).not.toThrow()
  })

  it('throws REPLAY_DIVERGED at the first mismatched label', () => {
    const fingerprint = createReplayFingerprint({
      recorded: ['step:plan', 'suspend:approval'],
    })

    fingerprint.observe('step:plan')

    expect(() => fingerprint.observe('step:renamed')).toThrow(
      CruxRuntimeError,
    )
    expect(() => fingerprint.observe('step:renamed')).toThrow(
      /expected `suspend:approval` at position 1 but observed `step:renamed`/,
    )
  })

  it('throws REPLAY_DIVERGED when replay ends before the recorded prefix', () => {
    const fingerprint = createReplayFingerprint({
      recorded: ['step:plan', 'suspend:approval'],
    })

    fingerprint.observe('step:plan')

    expect(() => fingerprint.complete()).toThrow(CruxRuntimeError)
    expect(() => fingerprint.complete()).toThrow(
      /expected `suspend:approval` at position 1 but observed `end-of-flow`/,
    )
  })

  it('builds reserved signal event names for signal delivery', () => {
    expect(runtimeSignalEventName('flow_1', 'approval')).toBe(
      'crux.signal:flow_1:approval',
    )
  })

  it('renders replay diagnostics with expected and actual labels', () => {
    const error = replayDivergedError({
      expected: 'step:plan',
      actual: 'step:draft',
      position: 0,
    })

    expect(error.code).toBe('REPLAY_DIVERGED')
    expect(error.message).toContain('expected `step:plan`')
    expect(error.message).toContain('observed `step:draft`')
  })
})
