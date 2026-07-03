import { describe, expect, it } from 'vitest'
import { CruxRuntimeError } from '../../runtime/engine/errors'
import {
  decodeWakeEnvelope,
  encodeWakeEnvelope,
  type WakeEnvelope,
} from '../../runtime/engine/envelope'
import type { RuntimeTargetId, WorkId } from '../../runtime/ports/ids'

describe('wake envelope encoding', () => {
  it('round-trips the portable wake envelope', () => {
    const envelope = makeEnvelope()

    expect(decodeWakeEnvelope(encodeWakeEnvelope(envelope))).toEqual(envelope)
  })

  it('rejects non-JSON envelope values with PAYLOAD_NOT_JSON', () => {
    const invalid = {
      ...makeEnvelope(),
      ns: () => 'local',
    } as unknown as WakeEnvelope

    expect(() => encodeWakeEnvelope(invalid)).toThrow(CruxRuntimeError)
    expect(() => encodeWakeEnvelope(invalid)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_NOT_JSON' }),
    )
  })

  it('rejects envelopes larger than four kilobytes', () => {
    const large = makeEnvelope({ idempotencyKey: `task:${'x'.repeat(5000)}` })

    expect(() => encodeWakeEnvelope(large)).toThrow(
      expect.objectContaining({ code: 'CAPABILITY_MISSING' }),
    )
  })
})

function makeEnvelope(overrides: Partial<WakeEnvelope> = {}): WakeEnvelope {
  return {
    v: 1,
    ns: 'local',
    workId: 'work_1' as WorkId,
    target: 'review' as RuntimeTargetId,
    kind: 'task.run',
    idempotencyKey: 'task:work_1',
    attempt: 1,
    ...overrides,
  }
}
