import { afterEach, describe, expect, it } from 'vitest'
import { flow } from '@use-crux/core'
import {
  durableTask,
  type FlowId,
  type WorkStatus,
} from '@use-crux/core/runtime'
import {
  createTestRuntime,
  type TestRuntime,
} from '@use-crux/core/runtime/testing'
import { resetHooks } from '../../src/runtime/runtime'

let runtime: TestRuntime | undefined

afterEach(() => {
  runtime?.dispose()
  runtime = undefined
  resetHooks()
})

describe('createTestRuntime()', () => {
  it('drives runtime-backed flow timers with an injected clock', async () => {
    const prepared: Array<{ userId: string }> = []
    const reminders: Array<{ userId: string }> = []
    const prepareAccount = durableTask('phase-9-prepare-account', {
      run: (input: { userId: string }) => {
        prepared.push(input)
      },
    })
    const sendReminder = durableTask('phase-9-send-reminder', {
      run: (input: { userId: string }) => {
        reminders.push(input)
      },
    })
    const onboarding = flow(
      'phase-9-onboarding',
      async (scope, input: { userId: string }) => {
        await scope.defer(prepareAccount, { userId: input.userId })
        await scope.after(sendReminder, '2d', { userId: input.userId })
        await scope.suspend('approval')
        return 'approved'
      },
    )

    runtime = createTestRuntime({
      targets: [onboarding, prepareAccount, sendReminder],
      epoch: new Date('2026-07-07T00:00:00.000Z'),
    })

    const suspended = await onboarding.run({ userId: 'user_1' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedAt: 'approval',
    })
    expect(prepared).toEqual([])
    expect(reminders).toEqual([])

    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: runtime.runtime.namespace },
    )
    const deferredWorkId = snapshot?.scheduledWork?.['defer:1']?.workId
    const timerId = snapshot?.scheduledWork?.['after:2']?.timerId
    expect(deferredWorkId).toEqual(expect.any(String))
    expect(timerId).toEqual(expect.any(String))

    await runtime.settle()
    expect(prepared).toEqual([{ userId: 'user_1' }])
    expect(reminders).toEqual([])
    await expect(workStatusCounts()).resolves.toMatchObject({
      completed: 1,
      suspended: 1,
    })

    await runtime.clock.advance('47h')
    expect(reminders).toEqual([])

    await runtime.clock.advance('1h')
    expect(reminders).toEqual([{ userId: 'user_1' }])
    await expect(workStatusCounts()).resolves.toMatchObject({
      completed: 1,
      suspended: 1,
    })
  })

  it('throws when settle cannot prove idleness within maxTicks', async () => {
    const noop = durableTask('phase-9-noop', {
      run: () => undefined,
    })
    runtime = createTestRuntime({ targets: [noop] })

    await expect(runtime.settle({ maxTicks: 1 })).rejects.toThrow(
      /advance the clock or raise maxTicks/,
    )
  })
})

async function workStatusCounts(): Promise<Partial<Record<WorkStatus, number>>> {
  if (!runtime) return {}
  const rows = await runtime.store.state.countWork({
    namespace: runtime.runtime.namespace,
  })
  return Object.fromEntries(rows.map((row) => [row.status, row.count]))
}
