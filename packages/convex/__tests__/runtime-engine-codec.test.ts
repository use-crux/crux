import { describe, expect, it } from 'vitest'
import type {
  FlowId,
  FlowSnapshot,
  RuntimeTargetId,
  WorkId,
} from '@use-crux/core/runtime'
import { decodeSnapshot, encodeSnapshot } from '../src/runtime-engine/codec'

describe('Convex Runtime snapshot codec', () => {
  it('round-trips pending flow timeout deadlines', () => {
    const deadline = new Date('2026-07-18T01:00:00.000Z')
    const snapshot: FlowSnapshot = {
      flowId: 'flow_timeout' as FlowId,
      workId: 'work_timeout' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'suspended',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [{ label: 'approval', timeoutAt: deadline }],
      updatedAt: deadline,
    }
    const encoded = encodeSnapshot(snapshot)
    const pending = encoded.pendingSuspends as Array<Record<string, unknown>>

    expect(pending[0]?.timeoutAt).toBe(deadline.getTime())
    expect(
      decodeSnapshot<FlowSnapshot>(encoded).pendingSuspends[0]?.timeoutAt,
    ).toEqual(deadline)
  })
})
