import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_MAX_ATTEMPTS,
  type FlowId,
  type FlowSnapshot,
  type RuntimeTargetId,
  type RuntimeWorkItem,
  type TaskId,
  type WorkId,
} from '@use-crux/core/runtime'
import {
  decodeSnapshot,
  decodeWork,
  encodeSnapshot,
  encodeWork,
} from '../src/runtime-engine/codec'

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

describe('Convex Runtime work codec', () => {
  it('persists denormalized list indexes without leaking them on decode', () => {
    const now = new Date('2026-07-02T00:00:00.000Z')
    const work: RuntimeWorkItem = {
      workId: 'work_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'session.signal-ingress',
        sessionId: 'session_1',
        deliveryId: 'delivery_1',
        occurrenceId: 'occurrence_1',
        subscriptionId: 'subscription_1',
      },
      targetId: 'agent' as RuntimeTargetId,
      status: 'pending',
      attempt: 1,
      maxAttempts: DEFAULT_RUNTIME_MAX_ATTEMPTS,
      idempotencyKey: 'ingress:work_1',
      createdAt: now,
      updatedAt: now,
    }

    const encoded = encodeWork(work)
    expect(encoded.workKind).toBe('session.signal-ingress')
    expect(encoded.workSessionId).toBe('session_1')

    const decoded = decodeWork(encoded)
    expect(decoded).toEqual(work)
    expect(decoded).not.toHaveProperty('workKind')
    expect(decoded).not.toHaveProperty('workSessionId')
    expect(Object.isFrozen(decoded)).toBe(true)
  })

  it('strips denormalized indexes for task work without session scope', () => {
    const now = new Date('2026-07-02T00:00:00.000Z')
    const work: RuntimeWorkItem = {
      workId: 'work_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_1' as TaskId,
        targetId: 'review' as RuntimeTargetId,
      },
      targetId: 'review' as RuntimeTargetId,
      status: 'pending',
      attempt: 1,
      maxAttempts: DEFAULT_RUNTIME_MAX_ATTEMPTS,
      idempotencyKey: 'task:work_1',
      createdAt: now,
      updatedAt: now,
    }

    const encoded = encodeWork(work)
    expect(encoded.workKind).toBe('task.run')
    expect(encoded).not.toHaveProperty('workSessionId')
    expect(decodeWork(encoded)).toEqual(work)
  })
})
