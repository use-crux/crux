import { afterEach, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import {
  node,
  type FlowId,
  type RuntimeTargetId,
  type WorkId,
} from '@use-crux/core/runtime'
import { resetRuntime } from '../../runtime/runtime'

afterEach(() => {
  resetRuntime()
})

describe('runtime-backed flows', () => {
  it('suspends into runtime state and auto-resumes when the flow handle signals', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope, input: { documentId: string }) => {
      const draft = await scope.step('draft', () => {
        steps.push('draft')
        return { documentId: input.documentId, version: 1 }
      })
      const approval = await scope.suspend<{ approvedBy: string }>('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return { ...draft, approval }
      })
    })

    const suspended = await reviewFlow.run({ documentId: 'doc_1' })

    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedAt: 'approval',
    })
    expect(steps).toEqual(['draft'])
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    expect(snapshot).toMatchObject({
      flowId: suspended.flowId,
      targetId: 'review' as RuntimeTargetId,
      status: 'suspended',
      input: { documentId: 'doc_1' },
      completedSteps: {
        draft: { documentId: 'doc_1', version: 1 },
      },
      fingerprint: ['step:draft', 'suspend:approval'],
    })

    await reviewFlow.signal(suspended.flowId, 'approval', {
      approvedBy: 'henri',
    })

    expect(steps).toEqual(['draft', 'publish'])
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    crux.dispose()
  })

  it('does not execute a completed flow again when a later signal is delivered', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return 'published'
      })
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', {})
    await reviewFlow.signal(suspended.flowId, 'approval', {})

    expect(steps).toEqual(['draft', 'publish'])

    crux.dispose()
  })

  it('can store a runtime signal and resume later through the flow handle', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return 'published'
      })
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', {}, { resume: false })

    expect(steps).toEqual(['draft'])

    const resumed = await reviewFlow.resume(suspended.flowId)

    expect(resumed).toMatchObject({ status: 'completed', flowId: suspended.flowId })
    expect(steps).toEqual(['draft', 'publish'])

    crux.dispose()
  })

  it('blocks runtime work when replay fingerprint diverges before a cached step', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const original = flow('review', async (scope) => {
      await scope.step('draft', () => 'drafted')
      await scope.suspend('approval')
      return 'done'
    })
    const suspended = await original.run()
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    const renamedStepExecutions: string[] = []
    const changed = flow('review', async (scope) => {
      await scope.step('renamed-draft', () => {
        renamedStepExecutions.push('renamed-draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return 'done'
    })

    await changed.signal(suspended.flowId, 'approval', {})

    expect(renamedStepExecutions).toEqual([])
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      lastError: {
        code: 'REPLAY_DIVERGED',
        message: expect.stringContaining('expected `step:draft`'),
      },
    })

    crux.dispose()
  })
})
