import { describe, expect, it } from 'vitest'
import type { EventCursor, TimerId, WorkId } from '../../runtime/ports'
import {
  flowEventResumeKey,
  flowSignalResumeKey,
  taskRunKey,
  timerKey,
  watchDeliverKey,
} from '../../runtime/engine/idempotency'

describe('runtime idempotency key builders', () => {
  it('formats every runtime delivery key from stable identifiers', () => {
    expect(
      flowEventResumeKey('work_1' as WorkId, 'evt_42' as EventCursor),
    ).toBe('resume:work_1:evt_42')
    expect(flowSignalResumeKey('work_1' as WorkId, 'approval', 'sig_9')).toBe(
      'resume:work_1:signal:approval:sig_9',
    )
    expect(timerKey('timer_1' as TimerId)).toBe('timer:timer_1')
    expect(taskRunKey('work_task_1' as WorkId)).toBe('task:work_task_1')
    expect(watchDeliverKey('workspace', 'evt_100' as EventCursor)).toBe(
      'watch:workspace:evt_100',
    )
  })
})
