import { describe, expect, it } from 'vitest'
import type {
  EventCursor,
  TimerId,
  WaiterId,
  WorkId,
} from '../../runtime/ports'
import {
  flowEventResumeKey,
  flowManualResumeKey,
  operatorRetryKey,
  taskRunKey,
  timerKey,
  waiterTimeoutKey,
} from '../../runtime/engine/idempotency'

describe('runtime idempotency key builders', () => {
  it('formats every runtime delivery key from stable identifiers', () => {
    expect(
      flowEventResumeKey('work_1' as WorkId, 'evt_42' as EventCursor),
    ).toBe('resume:work_1:evt_42')
    expect(timerKey('timer_1' as TimerId)).toBe('timer:timer_1')
    expect(waiterTimeoutKey('waiter_1' as WaiterId)).toBe('timer:waiter_1')
    expect(taskRunKey('work_task_1' as WorkId)).toBe('task:work_task_1')
  })

  it('makes manual resume and operator retry keys unique per invocation', () => {
    const now = new Date('2026-07-02T00:00:00.000Z')
    const manualA = flowManualResumeKey('work_1' as WorkId, now)
    const manualB = flowManualResumeKey('work_1' as WorkId, now)
    const retryA = operatorRetryKey('work_1' as WorkId, now)
    const retryB = operatorRetryKey('work_1' as WorkId, now)

    expect(manualA).toMatch(/^resume:work_1:manual:mr2qmtc0:[a-z0-9]+:/)
    expect(manualB).toMatch(/^resume:work_1:manual:mr2qmtc0:[a-z0-9]+:/)
    expect(manualA).not.toBe(manualB)
    expect(retryA).toMatch(/^retry:work_1:mr2qmtc0:[a-z0-9]+:/)
    expect(retryB).toMatch(/^retry:work_1:mr2qmtc0:[a-z0-9]+:/)
    expect(retryA).not.toBe(retryB)
  })
})
