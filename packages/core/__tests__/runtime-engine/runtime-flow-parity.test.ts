import { afterEach, describe, expect, it } from 'vitest'
import { config, flow, noPayload } from '@use-crux/core'
import { node } from '@use-crux/core/runtime'
import { getExecutionContext } from '../../src/runtime/execution-context'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'

afterEach(() => {
  resetHooks()
})

describe('runtime flow parity', () => {
  it('matches object-bound behavior for repeated same-name signal suspends', async () => {
    await expectRuntimeParity('repeated-signals', async (name) => {
      const review = flow(name, async (scope) => {
        const first = await scope.suspend<{ value: string }>('approval')
        const second = await scope.suspend<{ value: string }>('approval')
        return [first.value, second.value]
      })

      const suspended = await review.run({ flowId: `${name}-flow` })
      await review.signal(suspended.flowId, 'approval', { value: 'first' }, { resume: false })
      const waitingAgain = await review.resume(suspended.flowId)
      await review.signal(suspended.flowId, 'approval', { value: 'second' }, { resume: false })
      const completed = await review.resume(suspended.flowId)

      return {
        firstResumeStatus: waitingAgain.status,
        firstResumeSuspendedAt: waitingAgain.status === 'suspended' ? waitingAgain.suspendedAt : undefined,
        finalStatus: completed.status,
        output: completed.status === 'completed' ? completed.output : undefined,
      }
    })
  })

  it('matches object-bound behavior for null signal payload replay', async () => {
    await expectRuntimeParity('null-signal', async (name) => {
      const review = flow(name, async (scope) => {
        return await scope.suspend<null>('approval')
      })

      const suspended = await review.run({ flowId: `${name}-flow` })
      await review.signal(suspended.flowId, 'approval', null, { resume: false })
      const completed = await review.resume(suspended.flowId)

      return {
        status: completed.status,
        output: completed.status === 'completed' ? completed.output : undefined,
      }
    })
  })

  it('matches object-bound behavior for resume execution context options', async () => {
    await expectRuntimeParity('resume-context', async (name) => {
      const review = flow(name, async (scope) => {
        await scope.suspend('approval')
        return getExecutionContext()?.parentFlowId ?? null
      })

      const suspended = await review.run({ flowId: `${name}-flow` })
      await review.signal(suspended.flowId, 'approval', {}, { resume: false })
      const completed = await review.resume(suspended.flowId, {
        parentFlowId: 'flow_parent_1',
        goal: 'Resume after approval',
      })

      return {
        status: completed.status,
        output: completed.status === 'completed' ? completed.output : undefined,
      }
    })
  })

  it('matches object-bound validation for no-payload signal lookalike options', async () => {
    await expectRuntimeRejection('no-payload-validation', async (name) => {
      const release = flow(
        name,
        { signals: { release: noPayload() } },
        async (scope) => {
          await scope.suspend('release')
          return 'released'
        },
      )

      const suspended = await release.run({ flowId: `${name}-flow` })
      await release.signal(suspended.flowId, 'release', { unexpected: true } as never)
    })
  })
})

async function expectRuntimeParity<T>(
  name: string,
  runScenario: (name: string) => Promise<T>,
): Promise<void> {
  updateHooks({ records: inMemoryRecordStore() })
  const objectBound = await runScenario(`${name}-object`)
  resetHooks()

  const runtime = node({
    namespace: `${name}-runtime-namespace`,
    autoStartMaintenance: false,
  })
  const crux = config({ runtime })

  try {
    await expect(runScenario(`${name}-runtime`)).resolves.toEqual(objectBound)
  } finally {
    crux.dispose()
  }
}

async function expectRuntimeRejection(
  name: string,
  runScenario: (name: string) => Promise<void>,
): Promise<void> {
  updateHooks({ records: inMemoryRecordStore() })
  await expect(runScenario(`${name}-object`)).rejects.toThrow('expected no payload')
  resetHooks()

  const runtime = node({
    namespace: `${name}-runtime-namespace`,
    autoStartMaintenance: false,
  })
  const crux = config({ runtime })

  try {
    await expect(runScenario(`${name}-runtime`)).rejects.toThrow('expected no payload')
  } finally {
    crux.dispose()
  }
}
