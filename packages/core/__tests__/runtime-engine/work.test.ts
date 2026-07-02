import { describe, expect, it } from 'vitest'
import {
  transition,
  type WorkItem,
  type WorkStatus,
  type WorkTransition,
} from '../../runtime/engine/work'
import type {
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  WorkId,
} from '../../runtime/ports/ids'

describe('runtime work state machine', () => {
  it('leases pending work without mutating the original item', () => {
    const work = makeWorkItem({ status: 'pending' })

    const leased = transition(work, {
      status: 'leased',
      leaseToken: 'lease_1' as LeaseToken,
    })

    expect(leased).toMatchObject({
      status: 'leased',
      leaseToken: 'lease_1',
    })
    expect(work.status).toBe('pending')
    expect(work.leaseToken).toBeUndefined()
  })

  it('allows every documented runtime work transition', () => {
    const error = {
      code: 'TARGET_NOT_FOUND',
      message: 'Target missing.',
      at: new Date('2026-07-02T00:01:00.000Z'),
    }

    expect(
      transition(makeWorkItem({ status: 'leased' }), { status: 'completed' })
        .status,
    ).toBe('completed')
    expect(
      transition(makeWorkItem({ status: 'leased' }), { status: 'suspended' })
        .status,
    ).toBe('suspended')
    expect(
      transition(makeWorkItem({ status: 'leased' }), {
        status: 'pending',
        attempt: 2,
      }).status,
    ).toBe('pending')
    expect(
      transition(makeWorkItem({ status: 'leased' }), {
        status: 'dead-letter',
        lastError: error,
      }).status,
    ).toBe('dead-letter')
    expect(
      transition(makeWorkItem({ status: 'leased' }), {
        status: 'blocked',
        lastError: error,
      }).status,
    ).toBe('blocked')
    expect(
      transition(makeWorkItem({ status: 'suspended' }), { status: 'pending' })
        .status,
    ).toBe('pending')
    expect(
      transition(makeWorkItem({ status: 'pending' }), { status: 'cancelled' })
        .status,
    ).toBe('cancelled')
    expect(
      transition(makeWorkItem({ status: 'leased' }), { status: 'cancelled' })
        .status,
    ).toBe('cancelled')
    expect(
      transition(makeWorkItem({ status: 'suspended' }), { status: 'cancelled' })
        .status,
    ).toBe('cancelled')
    expect(
      transition(makeWorkItem({ status: 'blocked' }), { status: 'pending' })
        .status,
    ).toBe('pending')
    expect(
      transition(makeWorkItem({ status: 'dead-letter' }), { status: 'pending' })
        .status,
    ).toBe('pending')
  })

  it('rejects every undocumented runtime work transition', () => {
    for (const from of WORK_STATUSES) {
      for (const to of WORK_STATUSES) {
        if (LEGAL_TRANSITIONS.has(`${from}->${to}`)) continue

        expect(() =>
          transition(makeWorkItem({ status: from }), transitionTo(to)),
        ).toThrow(`Illegal runtime work transition: ${from} -> ${to}`)
      }
    }
  })
})

const WORK_STATUSES: readonly WorkStatus[] = [
  'pending',
  'leased',
  'suspended',
  'completed',
  'cancelled',
  'blocked',
  'dead-letter',
]

const LEGAL_TRANSITIONS = new Set<string>([
  'pending->leased',
  'pending->cancelled',
  'leased->completed',
  'leased->suspended',
  'leased->pending',
  'leased->dead-letter',
  'leased->blocked',
  'leased->cancelled',
  'suspended->pending',
  'suspended->cancelled',
  'blocked->pending',
  'dead-letter->pending',
])

function transitionTo(status: WorkStatus): WorkTransition {
  const error = {
    code: 'TARGET_NOT_FOUND',
    message: 'Target missing.',
    at: new Date('2026-07-02T00:01:00.000Z'),
  }

  switch (status) {
    case 'leased':
      return { status, leaseToken: 'lease_1' as LeaseToken }
    case 'pending':
      return { status }
    case 'blocked':
    case 'dead-letter':
      return { status, lastError: error }
    case 'completed':
    case 'suspended':
    case 'cancelled':
      return { status }
  }
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: 'work_1' as WorkId,
    namespace: 'local',
    work: {
      kind: 'task.run',
      taskId: 'task_1' as TaskId,
      targetId: 'target_1' as RuntimeTargetId,
    },
    targetId: 'target_1' as RuntimeTargetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: 'task:work_1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
